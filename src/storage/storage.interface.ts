import type { Job, SaveOptions, StorageSaveResult } from "../types/job.types.js";

/**
 * Storage contract for job persistence.
 * Pipeline interacts solely through this interface.
 */
export interface IJobStorage {
  /**
   * Reads all existing jobs currently stored.
   */
  loadExisting(): Promise<Job[]>;

  /**
   * Persists fresh jobs, merging with existing records, updating timestamps,
   * deactivating closed jobs, and saving back to storage.
   */
  save(freshJobs: Job[], options?: SaveOptions | undefined): Promise<StorageSaveResult>;
}
