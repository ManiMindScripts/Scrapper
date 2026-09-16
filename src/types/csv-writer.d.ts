declare module "csv-writer" {
  export interface ObjectStringifierHeader {
    id: string;
    title: string;
  }

  export interface ObjectCsvWriterParams {
    path: string;
    header: ObjectStringifierHeader[];
    append?: boolean | undefined;
    encoding?: BufferEncoding | undefined;
    fieldDelimiter?: string | undefined;
    recordDelimiter?: string | undefined;
    alwaysQuote?: boolean | undefined;
  }

  export interface CsvWriter<T> {
    writeRecords(records: T[]): Promise<void>;
  }

  export function createObjectCsvWriter(
    params: ObjectCsvWriterParams,
  ): CsvWriter<Record<string, unknown>>;

  interface CsvWriterModule {
    createObjectCsvWriter: typeof createObjectCsvWriter;
    createArrayCsvWriter: unknown;
    createObjectCsvStringifier: unknown;
    createArrayCsvStringifier: unknown;
  }

  const csvWriter: CsvWriterModule;
  export default csvWriter;
}
