/**
 * Bootstrap database types. `npm run db:types` replaces this file with the
 * exact schema emitted by Supabase after migrations are applied.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: Record<string, {
      Row: Record<string, unknown>
      Insert: Record<string, unknown>
      Update: Record<string, unknown>
      Relationships: []
    }>
    Views: Record<string, {
      Row: Record<string, unknown>
      Relationships: []
    }>
    Functions: Record<string, { Args: Record<string, unknown>; Returns: Json }>
    Enums: Record<string, string>
    CompositeTypes: Record<string, never>
  }
}
