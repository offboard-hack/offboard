import { describe, expect, it } from "vitest";
import {
  EmployeeAccessChanged,
  employeeQueryKey,
  removeOtherEmployeeQueries,
} from "@/entities/employee";
import { createPortalQueryClient } from "./query-client";

function createTestClient() {
  const destinations: string[] = [];

  const client = createPortalQueryClient({
    replace(path) {
      destinations.push(String(path));
    },
  });

  return { client, destinations };
}

describe("employee session changes in the portal", () => {
  it("removes the previous grant's data when navigation receives a new account", () => {
    const { client, destinations } = createTestClient();
    const previous = [...employeeQueryKey, "former-user", "former-case", "former-grant", "consent"];

    const account = {
      id: "new-user",
      caseId: "new-case",
      grantId: "new-grant",
      name: "Colaborador",
      email: "colaborador@example.com",
    };

    const current = [...employeeQueryKey, account.id, account.caseId, account.grantId, "consent"];
    client.setQueryData(previous, "previous");
    client.setQueryData(current, "current");

    removeOtherEmployeeQueries(client, account);

    expect(client.getQueriesData({ queryKey: employeeQueryKey })).toEqual([[current, "current"]]);
    expect(destinations).toEqual([]);
  });

  it("clears private reads and returns to login when a read detects an account change", async () => {
    const { client, destinations } = createTestClient();

    client.setQueryData([...employeeQueryKey, "previous"], "private");
    client.setQueryData(["other"], "unrelated");

    await expect(
      client.fetchQuery({
        queryKey: [...employeeQueryKey, "consent"],
        queryFn: () => {
          throw new EmployeeAccessChanged();
        },
        retry: false,
      }),
    ).rejects.toBeInstanceOf(EmployeeAccessChanged);
    expect(client.getQueriesData({ queryKey: employeeQueryKey })).toEqual([]);
    expect(client.getQueryData(["other"])).toBe("unrelated");
    expect(destinations).toEqual(["/colaborador/entrar"]);
  });

  it("clears private reads and returns to login when a write detects an account change", async () => {
    const { client, destinations } = createTestClient();

    client.setQueryData([...employeeQueryKey, "previous"], "private");

    const write = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(new EmployeeAccessChanged()),
    });

    await expect(write.execute(undefined)).rejects.toBeInstanceOf(EmployeeAccessChanged);
    expect(client.getQueriesData({ queryKey: employeeQueryKey })).toEqual([]);
    expect(destinations).toEqual(["/colaborador/entrar"]);
  });

  it("preserves the cache when a request fails without changing access", async () => {
    const { client, destinations } = createTestClient();

    client.setQueryData([...employeeQueryKey, "current"], "private");

    await expect(
      client.fetchQuery({
        queryKey: [...employeeQueryKey, "journey"],
        queryFn: () => {
          throw new Error("Network unavailable");
        },
        retry: false,
      }),
    ).rejects.toThrow("Network unavailable");
    expect(client.getQueryData([...employeeQueryKey, "current"])).toBe("private");
    expect(destinations).toEqual([]);
  });
});
