// Copyright 2026 Gilles Reant. SPDX-License-Identifier: Apache-2.0
export type Field = { [id: string]: string | number | Field[] };
export const Fields: Readonly<{
  PAYLOAD_FORMAT_INDICATOR: '00';
  POINT_OF_INITIATION_METHOD: '01';
  MERCHANT_CATEGORY_CODE: '52';
  TRANSACTION_CURRENCY: '53';
  TRANSACTION_AMOUNT: '54';
  TIP_OR_CONVENIENCE_INDICATOR: '55';
  VALUE_OF_CONVENIENCE_FEE_FIXED: '56';
  VALUE_OF_CONVENIENCE_FEE_PERCENTAGE: '57';
  COUNTRY_CODE: '58';
  MERCHANT_NAME: '59';
  MERCHANT_CITY: '60';
  POSTAL_CODE: '61';
  ADDITIONAL_DATA_FIELD_TEMPLATE: '62';
  CRC: '63';
  MERCHANT_INFORMATION_LANGUAGE_TEMPLATE: '64';
}>;
export const AdditionalDataFields: Readonly<{
  BILL_NUMBER: '01';
  MOBILE_NUMBER: '02';
  STORE_LABEL: '03';
  LOYALTY_NUMBER: '04';
  REFERENCE_LABEL: '05';
  CUSTOMER_LABEL: '06';
  TERMINAL_LABEL: '07';
  PURPOSE_OF_TRANSACTION: '08';
  ADDITIONAL_CONSUMER_DATA_REQUEST: '09';
}>;
export const LanguageFields: Readonly<{
  LANGUAGE_PREFERENCE: '00';
  MERCHANT_NAME_ALTERNATE_LANGUAGE: '01';
  MERCHANT_CITY_ALTERNATE_LANGUAGE: '02';
}>;
export const TemplateFields: Readonly<{ GLOBALLY_UNIQUE_IDENTIFIER: '00' }>;
export interface Diagnostic { code: string; message: string; path: string[]; offset?: number | null; severity: 'error' | 'warning'; }
export interface Node { id: string; name: string; path: string[]; length: number; offset: number; raw: string; value?: string; children: Node[]; template?: boolean; templateValid?: boolean; }
export interface Analysis {
  rawText: string; rawHex: string; byteCount: number; charCount: number; tree: Node[]; specificationSource: string;
  validation: { valid: boolean; errors: string[]; warnings: string[]; diagnostics: Diagnostic[]; checkedRules: string[]; crc: { ok: boolean; expected: string | null; actual: string | null; message: string } };
}
export type ValidationRule = (input: { rawText: string; tree: Node[] }) => Diagnostic[] | void;
export function computeCRC(text: string): string;
export function serialize(fields: Field[]): string;
export function buildPayload(fields: Field[], options?: { preserveExistingCrc?: boolean }): { payload: string; crc: string; fields: Field[] };
export function analyzePayload(text: string, options?: { rules?: ValidationRule[] }): Analysis;
export function parseTlv(text: string): { nodes: Node[]; consumed: number; complete: boolean; diagnostics: Diagnostic[]; errors: string[] };
export const limits: Readonly<{ maxCharacters: number; maxNodes: number; maxDepth: number }>;
