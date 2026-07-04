import { invoke } from "@tauri-apps/api/core";

export async function callTauri<T>(command: string, args?: Record<string, unknown>) {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}
