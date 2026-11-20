export type CaseSummary = {
  id: string;
  name: string;
  role: string;
  department: string;
  deadline: string;
  completed: number;
  total: number;
};

export type TaskDto = {
  id: string;
  caseId: string;
  title: string;
  team: string;
  status: "done" | "inProgress" | "todo";
};

export type OffboardingCaseDto = CaseSummary & { tasks: TaskDto[] };

export interface OffboardingRepository {
  list(): Promise<CaseSummary[]>;
  get(id: string): Promise<OffboardingCaseDto | null>;
  create(input: {
    name: string;
    role: string;
    department: string;
    deadline: string;
  }): Promise<{ id: string }>;
  createMany(
    inputs: { name: string; role: string; department: string; deadline: string }[],
  ): Promise<{ id: string }[]>;
  delete(id: string): Promise<void>;
}

export interface TaskRepository {
  listByCase(caseId: string): Promise<TaskDto[]>;
  create(
    caseId: string,
    input: { title: string; team: string; status?: TaskDto["status"] },
  ): Promise<{ id: string }>;
  updateStatus(id: string, status: TaskDto["status"]): Promise<void>;
}

export type EquipmentDto = {
  id: string;
  item: string;
  tag: string;
  person: string;
  method: string;
  scheduledDate: string | null;
  status: "scheduled" | "received" | "failed" | "inventory" | "transit" | "withPerson";
};

export interface EquipmentRepository {
  list(status?: EquipmentDto["status"]): Promise<EquipmentDto[]>;
}

export type IntegrationDto = {
  id: string;
  name: string;
  purpose: string;
  status: "connected" | "disconnected";
  lastActivity: string | null;
};

export interface IntegrationRepository {
  list(status?: IntegrationDto["status"]): Promise<IntegrationDto[]>;
}

export type BeneficiaryDto = {
  id: string;
  name: string;
  plan: string;
  status: string;
  accessUntil: string;
};

export type TeamMemberDto = {
  id: string;
  name: string;
  role: string;
  accessScope: string;
  securityStatus: string;
};

export interface AccessRepository {
  listBeneficiaries(): Promise<BeneficiaryDto[]>;
  listTeamMembers(): Promise<TeamMemberDto[]>;
}

export type PlanDto = {
  id: string;
  name: string;
  priceCents: number;
  activeLicenses: number;
  capacity: number;
  costCenter: string;
};

export interface BillingRepository {
  listPlans(): Promise<PlanDto[]>;
}

export type ChecklistRuleDto = {
  id: string;
  title: string;
  description: string;
  team: string;
  timing: string;
  required: boolean;
  enabled: boolean;
};

export interface ChecklistRepository {
  list(): Promise<ChecklistRuleDto[]>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
}

export interface Repositories {
  offboardings: OffboardingRepository;
  tasks: TaskRepository;
  equipment: EquipmentRepository;
  integrations: IntegrationRepository;
  access: AccessRepository;
  billing: BillingRepository;
  checklist: ChecklistRepository;
}
