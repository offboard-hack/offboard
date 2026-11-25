import { createApiClient } from "@offboard/api-client";
import { expoClient } from "@better-auth/expo/client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  QueryClient,
  QueryClientProvider,
  queryOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { createURL } from "expo-linking";
import * as SecureStore from "expo-secure-store";
import { createContext, type ReactNode, use, useState } from "react";
import { Platform } from "react-native";
import { z } from "zod";

type AuthMode = "demo" | "better-auth";

const accountSchema = z.object({ id: z.string(), name: z.string(), email: z.email() });

type Account = z.infer<typeof accountSchema> &
  ({ mode: "demo" } | { mode: "better-auth"; caseId: string; grantId: string });

type Session =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "signed-out" }
  | { status: "signed-in"; account: Account };

type Auth = {
  session: Session;
  mode: AuthMode;
  requestCode(email: string): Promise<void>;
  signIn(email: string, code: string): Promise<void>;
  startDemo(): Promise<void>;
  signOut(): Promise<void>;
  retry(): Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);
const demoKey = "offboard.mobile.demo-session";

const demoAccount = {
  mode: "demo",
  id: "demo-marina",
  name: "Marina Lopes",
  email: "marina.lopes@example.com",
} satisfies Account;

const configuredUrl = process.env.EXPO_PUBLIC_AUTH_URL;
const mode: AuthMode = configuredUrl ? "better-auth" : "demo";
const authUrl = z.url({ protocol: /^https?$/ }).safeParse(configuredUrl);

const client = authUrl.success
  ? createAuthClient({
      baseURL: authUrl.data,
      plugins:
        Platform.OS === "web"
          ? [emailOTPClient()]
          : [
              emailOTPClient(),
              expoClient({
                scheme: "offboard",
                storagePrefix: "offboard_mobile",
                cookiePrefix: "better-auth",
                storage: SecureStore,
              }),
            ],
    })
  : null;

export class AuthRequestError extends Error {}

function authFailure(error: { code?: string; status?: number }, fallback: string) {
  if (error.status === 429) {
    return new AuthRequestError("Muitas tentativas. Aguarde um momento e tente novamente.");
  }

  return new AuthRequestError(fallback);
}

function requireClient() {
  if (!client) {
    throw new AuthRequestError("O endereço do serviço de autenticação está indisponível.");
  }

  return client;
}

export function getEmployeeApi() {
  if (!authUrl.success) throw new AuthRequestError("O endereço da API está indisponível.");

  const authClient = requireClient();

  return createApiClient(authUrl.data, {
    parseDate: false,
    fetch: { cache: "no-store", credentials: Platform.OS === "web" ? "include" : "omit" },
    async fetcher(input, init) {
      if (Platform.OS === "web") return fetch(input, init);

      const headers = new Headers(init?.headers);
      const cookie = await authClient.getCookie();
      const deepLink = createURL("");

      if (cookie) headers.set("cookie", cookie);

      headers.set("expo-origin", deepLink.split("/--", 1)[0] ?? deepLink);

      return fetch(input, { ...init, headers });
    },
  });
}

type SessionData = Extract<Session, { status: "signed-out" | "signed-in" }>;

const readSession: (signal?: AbortSignal) => Promise<SessionData> = async (signal) => {
  if (mode === "demo") {
    const storedDemo = await AsyncStorage.getItem(demoKey);

    return storedDemo ? { status: "signed-in", account: demoAccount } : { status: "signed-out" };
  }

  const { data, error, status } = await getEmployeeApi().api.employee.session.get({
    fetch: { signal },
  });

  if (status === 401) return { status: "signed-out" };

  if (error) throw authFailure(error, "Não foi possível verificar sua sessão.");

  return {
    status: "signed-in",
    account: {
      ...accountSchema.parse(data),
      caseId: z.uuid().parse(data.caseId),
      grantId: z.uuid().parse(data.grantId),
      mode: "better-auth",
    },
  };
};

const sessionQuery = queryOptions({
  queryKey: ["employee-session", mode],
  queryFn: ({ signal }) => readSession(signal),
  staleTime: 30_000,
  networkMode: "always",
  retry: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <EmployeeSession>{children}</EmployeeSession>
    </QueryClientProvider>
  );
}

function EmployeeSession({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery(sessionQuery);
  let session: Session = { status: "loading" };

  if (query.isSuccess) {
    session = query.data;
  } else if (query.isError) {
    session = {
      status: "error",
      message:
        query.error instanceof AuthRequestError
          ? query.error.message
          : "Não foi possível verificar seu acesso. Tente novamente.",
    };
  }

  async function setSession(next: SessionData) {
    await queryClient.cancelQueries({ queryKey: sessionQuery.queryKey, exact: true });
    queryClient.setQueryData(sessionQuery.queryKey, next);
  }

  async function retry() {
    await queryClient.resetQueries({ queryKey: sessionQuery.queryKey, exact: true });
  }

  async function requestCode(email: string) {
    const { error } = await requireClient().emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });

    if (error) throw authFailure(error, "Não foi possível enviar o código. Tente novamente.");
  }

  async function signIn(email: string, code: string) {
    const { error } = await requireClient().signIn.emailOtp({ email, otp: code });

    if (error) throw authFailure(error, "Código inválido ou expirado. Confira ou solicite outro.");

    const next = await readSession();

    if (next.status !== "signed-in") {
      throw new AuthRequestError("Não foi possível iniciar sua sessão. Tente novamente.");
    }

    await setSession(next);
  }

  async function startDemo() {
    if (mode !== "demo") {
      throw new AuthRequestError("O acesso de demonstração está indisponível.");
    }

    await AsyncStorage.setItem(demoKey, "active");
    await setSession({ status: "signed-in", account: demoAccount });
  }

  async function signOut() {
    if (mode === "demo") {
      await AsyncStorage.removeItem(demoKey);
    } else {
      const { error } = await requireClient().signOut();

      if (error) {
        throw authFailure(error, "Não foi possível sair. Tente novamente.");
      }
    }

    await setSession({ status: "signed-out" });
  }

  return (
    <AuthContext.Provider value={{ session, mode, requestCode, signIn, startDemo, signOut, retry }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const auth = use(AuthContext);

  if (!auth) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  }

  return auth;
}
