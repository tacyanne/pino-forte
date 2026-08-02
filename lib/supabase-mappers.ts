type AnyRecord = Record<string, unknown>;

const snakeToCamel = (value: string) =>
  value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

export function camelizeRow<T = AnyRecord>(row: AnyRecord): T {
  const output: AnyRecord = {};
  for (const [key, value] of Object.entries(row)) {
    output[snakeToCamel(key)] = value;
  }
  return output as T;
}

export function camelizeRows<T = AnyRecord>(rows: AnyRecord[]): T[] {
  return rows.map((row) => camelizeRow<T>(row));
}
