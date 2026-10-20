import { LIMITS } from "./config";
import { isInsideRideWindow, parseInstant } from "./election";
import { ApiError, type JsonObject } from "./http";
import { cleanText, looksLikeCampaign } from "./text";

export function invalid(field: string, message: string): ApiError {
  return new ApiError(400, "campo_invalido", message, field);
}

function length(value: string): number {
  return [...value].length;
}

export function requiredText(body: JsonObject, field: string, max: number, label: string): string {
  const raw = body[field];
  if (typeof raw !== "string") throw invalid(field, `Preencha o campo ${label}.`);
  const value = cleanText(raw);
  if (value.length === 0) throw invalid(field, `Preencha o campo ${label}.`);
  if (length(value) > max) throw invalid(field, `O campo ${label} aceita no máximo ${max} caracteres.`);
  return value;
}

export function optionalText(body: JsonObject, field: string, max: number, label: string): string | null {
  const raw = body[field];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw invalid(field, `O campo ${label} é inválido.`);
  const value = cleanText(raw);
  if (value.length === 0) return null;
  if (length(value) > max) throw invalid(field, `O campo ${label} aceita no máximo ${max} caracteres.`);
  return value;
}

export function optionalBoolean(body: JsonObject, field: string): boolean {
  const raw = body[field];
  if (raw === undefined || raw === null) return false;
  if (typeof raw !== "boolean") throw invalid(field, "Valor inválido.");
  return raw;
}

export function integerInRange(raw: unknown, field: string, min: number, max: number, message: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
    throw invalid(field, message);
  }
  return raw;
}

export function departure(raw: unknown): Date {
  const date = parseInstant(raw);
  if (!date) throw invalid("saida", "Informe o horário de saída.");
  if (!isInsideRideWindow(date)) {
    throw invalid("saida", "A saída precisa ser no domingo, 25 de outubro, entre 9h e 17h.");
  }
  return date;
}

export function seats(raw: unknown): number {
  return integerInRange(
    raw,
    "vagas",
    LIMITS.vagasMin,
    LIMITS.vagasMax,
    `Ofereça entre ${LIMITS.vagasMin} e ${LIMITS.vagasMax} vagas.`,
  );
}

/** Rejects free text that looks like campaigning (candidates, parties, numbers next to vote words). */
export function screenNeutrality(values: ReadonlyArray<readonly [string, string | null]>): void {
  for (const [field, value] of values) {
    if (value !== null && looksLikeCampaign(value)) {
      throw new ApiError(
        422,
        "conteudo_de_campanha",
        "Não pode usar nome de candidato. A carona precisa ser neutra: não cite candidatos, partidos, números de urna nem peça voto.",
        field,
      );
    }
  }
}
