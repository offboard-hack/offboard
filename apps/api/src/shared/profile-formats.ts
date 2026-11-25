import type { Address } from "@offboard/db/schema";

export const formatCpf = (digits: string) =>
  digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

export const formatBirthDate = (value: string) => value.split("-").reverse().join("/");

export const formatCep = (digits: string) => digits.replace(/^(\d{5})(\d{3})$/, "$1-$2");

export function formatAddress(address: Address) {
  const line = address.complement ? `${address.number} - ${address.complement}` : address.number;

  return `${address.street}, ${line} - ${address.neighborhood}, ${address.city} - ${address.state}, CEP ${formatCep(address.cep)}`;
}
