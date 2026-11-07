export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      assignment_episodes: {
        Row: {
          acknowledged_at: string | null
          assigned_at: string
          assigned_by: string
          company_id: string | null
          created_at: string
          due_at: string
          end_reason: string | null
          ended_at: string | null
          id: string
          internal_assignee_user_id: string | null
          organization_id: string
          reassignment_reason: string | null
          started_at: string | null
          technician_user_id: string | null
          work_item_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          assigned_at?: string
          assigned_by: string
          company_id?: string | null
          created_at?: string
          due_at: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          internal_assignee_user_id?: string | null
          organization_id: string
          reassignment_reason?: string | null
          started_at?: string | null
          technician_user_id?: string | null
          work_item_id: string
        }
        Update: {
          acknowledged_at?: string | null
          assigned_at?: string
          assigned_by?: string
          company_id?: string | null
          created_at?: string
          due_at?: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          internal_assignee_user_id?: string | null
          organization_id?: string
          reassignment_reason?: string | null
          started_at?: string | null
          technician_user_id?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_episodes_organization_id_company_id_fkey"
            columns: ["organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "assignment_episodes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_episodes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_episodes_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_item_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "assignment_episodes_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      attachments: {
        Row: {
          activity_order: number
          bucket: string
          byte_size: number
          client_operation_id: string | null
          comment_id: string | null
          correction_attempt_id: string | null
          created_at: string
          derivative_object_key: string | null
          home_id: string | null
          id: string
          inspection_id: string | null
          mime_type: string
          neighborhood_id: string
          object_key: string
          organization_id: string
          original_name: string
          purpose: string
          ready_at: string | null
          rejection_reason: string | null
          scan_provider: string | null
          scan_reference: string | null
          sha256: string | null
          status: Database["public"]["Enums"]["attachment_status"]
          storage_deleted_at: string | null
          uploader_id: string
          visibility: Database["public"]["Enums"]["comment_visibility"]
          work_item_id: string | null
        }
        Insert: {
          activity_order?: number
          bucket?: string
          byte_size: number
          client_operation_id?: string | null
          comment_id?: string | null
          correction_attempt_id?: string | null
          created_at?: string
          derivative_object_key?: string | null
          home_id?: string | null
          id?: string
          inspection_id?: string | null
          mime_type: string
          neighborhood_id: string
          object_key: string
          organization_id: string
          original_name: string
          purpose: string
          ready_at?: string | null
          rejection_reason?: string | null
          scan_provider?: string | null
          scan_reference?: string | null
          sha256?: string | null
          status?: Database["public"]["Enums"]["attachment_status"]
          storage_deleted_at?: string | null
          uploader_id: string
          visibility?: Database["public"]["Enums"]["comment_visibility"]
          work_item_id?: string | null
        }
        Update: {
          activity_order?: number
          bucket?: string
          byte_size?: number
          client_operation_id?: string | null
          comment_id?: string | null
          correction_attempt_id?: string | null
          created_at?: string
          derivative_object_key?: string | null
          home_id?: string | null
          id?: string
          inspection_id?: string | null
          mime_type?: string
          neighborhood_id?: string
          object_key?: string
          organization_id?: string
          original_name?: string
          purpose?: string
          ready_at?: string | null
          rejection_reason?: string | null
          scan_provider?: string | null
          scan_reference?: string | null
          sha256?: string | null
          status?: Database["public"]["Enums"]["attachment_status"]
          storage_deleted_at?: string | null
          uploader_id?: string
          visibility?: Database["public"]["Enums"]["comment_visibility"]
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_organization_id_comment_id_fkey"
            columns: ["organization_id", "comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attachments_organization_id_correction_attempt_id_fkey"
            columns: ["organization_id", "correction_attempt_id"]
            isOneToOne: false
            referencedRelation: "correction_attempts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "home_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attachments_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attachments_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspection_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attachments_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attachments_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhood_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attachments_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attachments_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_item_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attachments_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_id: string | null
          after_data: Json | null
          before_data: Json | null
          entity_id: string | null
          entity_type: string
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          operation_id: string | null
          organization_id: string
        }
        Insert: {
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          operation_id?: string | null
          organization_id: string
        }
        Update: {
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          operation_id?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      blocker_events: {
        Row: {
          assignment_episode_id: string | null
          cause: string
          id: string
          notes: string
          opened_at: string
          opened_by: string
          organization_id: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          work_item_id: string
        }
        Insert: {
          assignment_episode_id?: string | null
          cause: string
          id?: string
          notes: string
          opened_at?: string
          opened_by: string
          organization_id: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          work_item_id: string
        }
        Update: {
          assignment_episode_id?: string | null
          cause?: string
          id?: string
          notes?: string
          opened_at?: string
          opened_by?: string
          organization_id?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocker_events_organization_id_assignment_episode_id_fkey"
            columns: ["organization_id", "assignment_episode_id"]
            isOneToOne: false
            referencedRelation: "assignment_episodes"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "blocker_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocker_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocker_events_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_item_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "blocker_events_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      business_calendars: {
        Row: {
          created_at: string
          holiday_dates: string[]
          id: string
          local_end_time: string
          local_start_time: string
          name: string
          organization_id: string
          timezone: string
          updated_at: string
          version: number
          working_weekdays: number[]
        }
        Insert: {
          created_at?: string
          holiday_dates?: string[]
          id?: string
          local_end_time?: string
          local_start_time?: string
          name: string
          organization_id: string
          timezone: string
          updated_at?: string
          version?: number
          working_weekdays?: number[]
        }
        Update: {
          created_at?: string
          holiday_dates?: string[]
          id?: string
          local_end_time?: string
          local_start_time?: string
          name?: string
          organization_id?: string
          timezone?: string
          updated_at?: string
          version?: number
          working_weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "business_calendars_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_calendars_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_questions: {
        Row: {
          created_at: string
          id: string
          label: string
          ordinal: number
          organization_id: string
          requires_response: boolean
          section: string
          version_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          ordinal: number
          organization_id: string
          requires_response?: boolean
          section: string
          version_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          ordinal?: number
          organization_id?: string
          requires_response?: boolean
          section?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_questions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_questions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_questions_organization_id_version_id_fkey"
            columns: ["organization_id", "version_id"]
            isOneToOne: false
            referencedRelation: "checklist_versions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          organization_id: string
          snapshot_home_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          organization_id: string
          snapshot_home_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          snapshot_home_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_templates_organization_id_snapshot_home_id_fkey"
            columns: ["organization_id", "snapshot_home_id"]
            isOneToOne: false
            referencedRelation: "home_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "checklist_templates_organization_id_snapshot_home_id_fkey"
            columns: ["organization_id", "snapshot_home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      checklist_versions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          number: number
          organization_id: string
          published_at: string | null
          template_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          number: number
          organization_id: string
          published_at?: string | null
          template_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          number?: number
          organization_id?: string
          published_at?: string | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_versions_organization_id_template_id_fkey"
            columns: ["organization_id", "template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      comments: {
        Row: {
          activity_order: number
          author_id: string
          body: string
          created_at: string
          id: string
          organization_id: string
          redacted_at: string | null
          redaction_reason: string | null
          visibility: Database["public"]["Enums"]["comment_visibility"]
          work_item_id: string
        }
        Insert: {
          activity_order?: number
          author_id: string
          body: string
          created_at?: string
          id?: string
          organization_id: string
          redacted_at?: string | null
          redaction_reason?: string | null
          visibility?: Database["public"]["Enums"]["comment_visibility"]
          work_item_id: string
        }
        Update: {
          activity_order?: number
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
          redacted_at?: string | null
          redaction_reason?: string | null
          visibility?: Database["public"]["Enums"]["comment_visibility"]
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_item_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "comments_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      companies: {
        Row: {
          categories: string[]
          contact_email: string | null
          created_at: string
          created_by: string | null
          external_vendor_reference: string | null
          id: string
          name: string
          organization_id: string
          owner_authority_level: number
          owner_division_id: string | null
          owner_neighborhood_id: string | null
          owner_scope_kind: Database["public"]["Enums"]["scope_kind"]
          phone_number: string | null
          physical_address: string | null
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
          version: number
        }
        Insert: {
          categories?: string[]
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          external_vendor_reference?: string | null
          id?: string
          name: string
          organization_id: string
          owner_authority_level?: number
          owner_division_id?: string | null
          owner_neighborhood_id?: string | null
          owner_scope_kind?: Database["public"]["Enums"]["scope_kind"]
          phone_number?: string | null
          physical_address?: string | null
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          categories?: string[]
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          external_vendor_reference?: string | null
          id?: string
          name?: string
          organization_id?: string
          owner_authority_level?: number
          owner_division_id?: string | null
          owner_neighborhood_id?: string | null
          owner_scope_kind?: Database["public"]["Enums"]["scope_kind"]
          phone_number?: string | null
          physical_address?: string | null
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_organization_id_owner_division_id_fkey"
            columns: ["organization_id", "owner_division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "companies_organization_id_owner_neighborhood_id_fkey"
            columns: ["organization_id", "owner_neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhood_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "companies_organization_id_owner_neighborhood_id_fkey"
            columns: ["organization_id", "owner_neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      company_access_grants: {
        Row: {
          authority_level: number
          company_id: string
          created_at: string
          division_id: string | null
          granted_by: string | null
          id: string
          neighborhood_id: string | null
          organization_id: string
          revocation_level: number | null
          revoked_at: string | null
          revoked_by: string | null
          scope_kind: Database["public"]["Enums"]["scope_kind"]
        }
        Insert: {
          authority_level: number
          company_id: string
          created_at?: string
          division_id?: string | null
          granted_by?: string | null
          id?: string
          neighborhood_id?: string | null
          organization_id: string
          revocation_level?: number | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope_kind: Database["public"]["Enums"]["scope_kind"]
        }
        Update: {
          authority_level?: number
          company_id?: string
          created_at?: string
          division_id?: string | null
          granted_by?: string | null
          id?: string
          neighborhood_id?: string | null
          organization_id?: string
          revocation_level?: number | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope_kind?: Database["public"]["Enums"]["scope_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "company_access_grants_organization_id_company_id_fkey"
            columns: ["organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "company_access_grants_organization_id_division_id_fkey"
            columns: ["organization_id", "division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "company_access_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_access_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_access_grants_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhood_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "company_access_grants_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      company_memberships: {
        Row: {
          active_from: string
          active_to: string | null
          authority_level: number
          company_id: string
          created_at: string
          granted_by: string | null
          id: string
          kind: string
          organization_id: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          active_from?: string
          active_to?: string | null
          authority_level?: number
          company_id: string
          created_at?: string
          granted_by?: string | null
          id?: string
          kind: string
          organization_id: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          active_from?: string
          active_to?: string | null
          authority_level?: number
          company_id?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          kind?: string
          organization_id?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_memberships_organization_id_company_id_fkey"
            columns: ["organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "company_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_private_details: {
        Row: {
          company_id: string
          ein: string | null
          organization_id: string
        }
        Insert: {
          company_id: string
          ein?: string | null
          organization_id: string
        }
        Update: {
          company_id?: string
          ein?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_private_details_organization_id_company_id_fkey"
            columns: ["organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      correction_attempts: {
        Row: {
          accountable_company_id: string | null
          accountable_internal_user_id: string | null
          assignment_episode_id: string
          attempt_number: number
          completion_note: string
          created_at: string
          evidence_exception_id: string | null
          id: string
          organization_id: string
          submitted_at: string
          submitted_by: string
          technician_user_id: string | null
          work_item_id: string
        }
        Insert: {
          accountable_company_id?: string | null
          accountable_internal_user_id?: string | null
          assignment_episode_id: string
          attempt_number: number
          completion_note: string
          created_at?: string
          evidence_exception_id?: string | null
          id?: string
          organization_id: string
          submitted_at?: string
          submitted_by: string
          technician_user_id?: string | null
          work_item_id: string
        }
        Update: {
          accountable_company_id?: string | null
          accountable_internal_user_id?: string | null
          assignment_episode_id?: string
          attempt_number?: number
          completion_note?: string
          created_at?: string
          evidence_exception_id?: string | null
          id?: string
          organization_id?: string
          submitted_at?: string
          submitted_by?: string
          technician_user_id?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "correction_attempts_organization_id_evidence_exception_id_fkey"
            columns: ["organization_id", "evidence_exception_id"]
            isOneToOne: false
            referencedRelation: "evidence_exceptions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "correction_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correction_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correction_attempts_organization_id_work_item_id_assignmen_fkey"
            columns: [
              "organization_id",
              "work_item_id",
              "assignment_episode_id",
            ]
            isOneToOne: false
            referencedRelation: "assignment_episodes"
            referencedColumns: ["organization_id", "work_item_id", "id"]
          },
        ]
      }
      divisions: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "divisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "divisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_route_steps: {
        Row: {
          created_at: string
          id: string
          level: number
          organization_id: string
          recipient_kind: string
          recipient_user_id: string | null
          route_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          level: number
          organization_id: string
          recipient_kind: string
          recipient_user_id?: string | null
          route_id: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: number
          organization_id?: string
          recipient_kind?: string
          recipient_user_id?: string | null
          route_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalation_route_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_route_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_route_steps_organization_id_route_id_fkey"
            columns: ["organization_id", "route_id"]
            isOneToOne: false
            referencedRelation: "escalation_routes"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      escalation_routes: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          organization_id: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          organization_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "escalation_routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_exceptions: {
        Row: {
          authorized_by: string
          consumed_by_attempt_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          organization_id: string
          reason: string
          work_item_id: string
        }
        Insert: {
          authorized_by: string
          consumed_by_attempt_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          organization_id: string
          reason: string
          work_item_id: string
        }
        Update: {
          authorized_by?: string
          consumed_by_attempt_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          organization_id?: string
          reason?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_exceptions_consumed_fk"
            columns: ["organization_id", "consumed_by_attempt_id"]
            isOneToOne: false
            referencedRelation: "correction_attempts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "evidence_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_exceptions_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_item_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "evidence_exceptions_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      export_jobs: {
        Row: {
          bucket: string
          created_at: string
          error_message: string | null
          expires_at: string | null
          export_kind: string
          filters: Json
          id: string
          object_key: string | null
          organization_id: string
          requested_by: string
          row_count: number | null
          status: string
          storage_deleted_at: string | null
          updated_at: string
        }
        Insert: {
          bucket?: string
          created_at?: string
          error_message?: string | null
          expires_at?: string | null
          export_kind: string
          filters?: Json
          id?: string
          object_key?: string | null
          organization_id: string
          requested_by: string
          row_count?: number | null
          status?: string
          storage_deleted_at?: string | null
          updated_at?: string
        }
        Update: {
          bucket?: string
          created_at?: string
          error_message?: string | null
          expires_at?: string | null
          export_kind?: string
          filters?: Json
          id?: string
          object_key?: string | null
          organization_id?: string
          requested_by?: string
          row_count?: number | null
          status?: string
          storage_deleted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      home_locations: {
        Row: {
          active: boolean
          created_at: string
          home_id: string
          id: string
          level: string | null
          name: string
          neighborhood_id: string
          organization_id: string
          parent_location_id: string | null
          source_plan_id: string | null
          space_type_code: string | null
          square_feet: number | null
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          home_id: string
          id?: string
          level?: string | null
          name: string
          neighborhood_id: string
          organization_id: string
          parent_location_id?: string | null
          source_plan_id?: string | null
          space_type_code?: string | null
          square_feet?: number | null
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          home_id?: string
          id?: string
          level?: string | null
          name?: string
          neighborhood_id?: string
          organization_id?: string
          parent_location_id?: string | null
          source_plan_id?: string | null
          space_type_code?: string | null
          square_feet?: number | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "home_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_locations_organization_id_home_id_parent_location_id_fkey"
            columns: ["organization_id", "home_id", "parent_location_id"]
            isOneToOne: false
            referencedRelation: "home_locations"
            referencedColumns: ["organization_id", "home_id", "id"]
          },
          {
            foreignKeyName: "home_locations_organization_id_neighborhood_id_home_id_fkey"
            columns: ["organization_id", "neighborhood_id", "home_id"]
            isOneToOne: false
            referencedRelation: "home_summary"
            referencedColumns: ["organization_id", "neighborhood_id", "id"]
          },
          {
            foreignKeyName: "home_locations_organization_id_neighborhood_id_home_id_fkey"
            columns: ["organization_id", "neighborhood_id", "home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["organization_id", "neighborhood_id", "id"]
          },
          {
            foreignKeyName: "home_locations_organization_id_source_plan_id_fkey"
            columns: ["organization_id", "source_plan_id"]
            isOneToOne: false
            referencedRelation: "master_plans"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "home_locations_space_type_code_fkey"
            columns: ["space_type_code"]
            isOneToOne: false
            referencedRelation: "space_types"
            referencedColumns: ["code"]
          },
        ]
      }
      home_milestones: {
        Row: {
          actual_at: string | null
          created_at: string
          home_id: string
          id: string
          milestone_code: string
          organization_id: string
          planned_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          actual_at?: string | null
          created_at?: string
          home_id: string
          id?: string
          milestone_code: string
          organization_id: string
          planned_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          actual_at?: string | null
          created_at?: string
          home_id?: string
          id?: string
          milestone_code?: string
          organization_id?: string
          planned_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "home_milestones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_milestones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_milestones_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "home_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "home_milestones_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      homes: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          archived_at: string | null
          city: string | null
          created_at: string
          external_reference: string | null
          id: string
          layout_mode: string
          lot_code: string
          master_plan_id: string | null
          master_plan_name: string | null
          master_plan_version: number | null
          neighborhood_id: string
          organization_id: string
          phase: string
          postal_code: string | null
          primary_supervisor_user_id: string | null
          state_code: string | null
          updated_at: string
          version: number
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          archived_at?: string | null
          city?: string | null
          created_at?: string
          external_reference?: string | null
          id?: string
          layout_mode?: string
          lot_code: string
          master_plan_id?: string | null
          master_plan_name?: string | null
          master_plan_version?: number | null
          neighborhood_id: string
          organization_id: string
          phase?: string
          postal_code?: string | null
          primary_supervisor_user_id?: string | null
          state_code?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          archived_at?: string | null
          city?: string | null
          created_at?: string
          external_reference?: string | null
          id?: string
          layout_mode?: string
          lot_code?: string
          master_plan_id?: string | null
          master_plan_name?: string | null
          master_plan_version?: number | null
          neighborhood_id?: string
          organization_id?: string
          phase?: string
          postal_code?: string | null
          primary_supervisor_user_id?: string | null
          state_code?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "homes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homes_organization_id_master_plan_id_fkey"
            columns: ["organization_id", "master_plan_id"]
            isOneToOne: false
            referencedRelation: "master_plans"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "homes_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhood_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "homes_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      inspection_engagements: {
        Row: {
          created_at: string
          ends_at: string
          home_id: string
          id: string
          inspector_user_id: string
          neighborhood_id: string
          organization_id: string
          purpose: string
          revoked_at: string | null
          starts_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          home_id: string
          id?: string
          inspector_user_id: string
          neighborhood_id: string
          organization_id: string
          purpose: string
          revoked_at?: string | null
          starts_at: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          home_id?: string
          id?: string
          inspector_user_id?: string
          neighborhood_id?: string
          organization_id?: string
          purpose?: string
          revoked_at?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_engagements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_engagements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_engagements_organization_id_neighborhood_id_hom_fkey"
            columns: ["organization_id", "neighborhood_id", "home_id"]
            isOneToOne: false
            referencedRelation: "home_summary"
            referencedColumns: ["organization_id", "neighborhood_id", "id"]
          },
          {
            foreignKeyName: "inspection_engagements_organization_id_neighborhood_id_hom_fkey"
            columns: ["organization_id", "neighborhood_id", "home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["organization_id", "neighborhood_id", "id"]
          },
        ]
      }
      inspection_observations: {
        Row: {
          created_at: string
          created_by: string
          description: string
          home_id: string
          id: string
          inspection_id: string
          location_id: string | null
          neighborhood_id: string
          organization_id: string
          priority: Database["public"]["Enums"]["work_priority"]
          question_id: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          safety_flag: boolean
          space_name: string
          status: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          description: string
          home_id: string
          id?: string
          inspection_id: string
          location_id?: string | null
          neighborhood_id: string
          organization_id: string
          priority?: Database["public"]["Enums"]["work_priority"]
          question_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          safety_flag?: boolean
          space_name: string
          status?: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string
          home_id?: string
          id?: string
          inspection_id?: string
          location_id?: string | null
          neighborhood_id?: string
          organization_id?: string
          priority?: Database["public"]["Enums"]["work_priority"]
          question_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          safety_flag?: boolean
          space_name?: string
          status?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "inspection_observations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_observations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_observations_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "home_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inspection_observations_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inspection_observations_organization_id_home_id_location_i_fkey"
            columns: ["organization_id", "home_id", "location_id"]
            isOneToOne: false
            referencedRelation: "home_locations"
            referencedColumns: ["organization_id", "home_id", "id"]
          },
          {
            foreignKeyName: "inspection_observations_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspection_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inspection_observations_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inspection_observations_organization_id_question_id_fkey"
            columns: ["organization_id", "question_id"]
            isOneToOne: false
            referencedRelation: "checklist_questions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      inspection_participants: {
        Row: {
          can_edit_draft: boolean
          created_at: string
          id: string
          inspection_id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          can_edit_draft?: boolean
          created_at?: string
          id?: string
          inspection_id: string
          organization_id: string
          user_id: string
        }
        Update: {
          can_edit_draft?: boolean
          created_at?: string
          id?: string
          inspection_id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_participants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_participants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_participants_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspection_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inspection_participants_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      inspection_responses: {
        Row: {
          created_at: string
          explanation: string | null
          finding_work_item_id: string | null
          id: string
          inspection_id: string
          organization_id: string
          question_id: string
          result: Database["public"]["Enums"]["inspection_result"]
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          explanation?: string | null
          finding_work_item_id?: string | null
          id?: string
          inspection_id: string
          organization_id: string
          question_id: string
          result: Database["public"]["Enums"]["inspection_result"]
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          explanation?: string | null
          finding_work_item_id?: string | null
          id?: string
          inspection_id?: string
          organization_id?: string
          question_id?: string
          result?: Database["public"]["Enums"]["inspection_result"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "inspection_responses_finding_fk"
            columns: ["organization_id", "finding_work_item_id"]
            isOneToOne: false
            referencedRelation: "work_item_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inspection_responses_finding_fk"
            columns: ["organization_id", "finding_work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inspection_responses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_responses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_responses_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspection_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inspection_responses_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inspection_responses_organization_id_question_id_fkey"
            columns: ["organization_id", "question_id"]
            isOneToOne: false
            referencedRelation: "checklist_questions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      inspection_submissions: {
        Row: {
          amendment_reason: string | null
          created_at: string
          id: string
          inspection_id: string
          organization_id: string
          previous_submission_id: string | null
          revision_number: number
          snapshot: Json
          submitted_at: string
          submitted_by: string
        }
        Insert: {
          amendment_reason?: string | null
          created_at?: string
          id?: string
          inspection_id: string
          organization_id: string
          previous_submission_id?: string | null
          revision_number: number
          snapshot: Json
          submitted_at?: string
          submitted_by: string
        }
        Update: {
          amendment_reason?: string | null
          created_at?: string
          id?: string
          inspection_id?: string
          organization_id?: string
          previous_submission_id?: string | null
          revision_number?: number
          snapshot?: Json
          submitted_at?: string
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_submissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_submissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_submissions_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspection_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inspection_submissions_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inspection_submissions_organization_id_previous_submission_fkey"
            columns: ["organization_id", "previous_submission_id"]
            isOneToOne: false
            referencedRelation: "inspection_submissions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      inspections: {
        Row: {
          cancellation_reason: string | null
          company_id: string | null
          created_at: string
          current_revision: number
          escalated_at: string | null
          escalation_reason: string | null
          escalation_resolved_at: string | null
          home_id: string
          id: string
          lead_inspector_user_id: string | null
          neighborhood_id: string
          organization_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["inspection_status"]
          template_version_id: string
          type: Database["public"]["Enums"]["inspection_type"]
          updated_at: string
          version: number
        }
        Insert: {
          cancellation_reason?: string | null
          company_id?: string | null
          created_at?: string
          current_revision?: number
          escalated_at?: string | null
          escalation_reason?: string | null
          escalation_resolved_at?: string | null
          home_id: string
          id?: string
          lead_inspector_user_id?: string | null
          neighborhood_id: string
          organization_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["inspection_status"]
          template_version_id: string
          type: Database["public"]["Enums"]["inspection_type"]
          updated_at?: string
          version?: number
        }
        Update: {
          cancellation_reason?: string | null
          company_id?: string | null
          created_at?: string
          current_revision?: number
          escalated_at?: string | null
          escalation_reason?: string | null
          escalation_resolved_at?: string | null
          home_id?: string
          id?: string
          lead_inspector_user_id?: string | null
          neighborhood_id?: string
          organization_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["inspection_status"]
          template_version_id?: string
          type?: Database["public"]["Enums"]["inspection_type"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "inspections_organization_id_company_id_fkey"
            columns: ["organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inspections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_organization_id_neighborhood_id_home_id_fkey"
            columns: ["organization_id", "neighborhood_id", "home_id"]
            isOneToOne: false
            referencedRelation: "home_summary"
            referencedColumns: ["organization_id", "neighborhood_id", "id"]
          },
          {
            foreignKeyName: "inspections_organization_id_neighborhood_id_home_id_fkey"
            columns: ["organization_id", "neighborhood_id", "home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["organization_id", "neighborhood_id", "id"]
          },
          {
            foreignKeyName: "inspections_organization_id_template_version_id_fkey"
            columns: ["organization_id", "template_version_id"]
            isOneToOne: false
            referencedRelation: "checklist_versions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          authority_level: number
          created_at: string
          delivery_error: string | null
          expires_at: string
          id: string
          invited_by: string
          normalized_email: string
          organization_id: string
          proposed_company_id: string | null
          proposed_grants: Json
          proposed_membership: Json
          status: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          authority_level?: number
          created_at?: string
          delivery_error?: string | null
          expires_at: string
          id?: string
          invited_by: string
          normalized_email: string
          organization_id: string
          proposed_company_id?: string | null
          proposed_grants?: Json
          proposed_membership: Json
          status?: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          authority_level?: number
          created_at?: string
          delivery_error?: string | null
          expires_at?: string
          id?: string
          invited_by?: string
          normalized_email?: string
          organization_id?: string
          proposed_company_id?: string | null
          proposed_grants?: Json
          proposed_membership?: Json
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_organization_id_proposed_company_id_fkey"
            columns: ["organization_id", "proposed_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      master_catalog_entries: {
        Row: {
          active: boolean
          code: string
          kind: string
          label: string
          sort_order: number
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          code: string
          kind: string
          label: string
          sort_order?: number
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          code?: string
          kind?: string
          label?: string
          sort_order?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      master_plans: {
        Row: {
          active: boolean
          created_at: string
          division_id: string
          id: string
          levels: number
          name: string
          organization_id: string
          spaces: Json
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          division_id: string
          id?: string
          levels?: number
          name: string
          organization_id: string
          spaces: Json
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          division_id?: string
          id?: string
          levels?: number
          name?: string
          organization_id?: string
          spaces?: Json
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "master_plans_organization_id_division_id_fkey"
            columns: ["organization_id", "division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "master_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      milestone_approvals: {
        Row: {
          approved_at: string
          approved_by: string
          home_id: string
          id: string
          invalidated_at: string | null
          invalidation_reason: string | null
          milestone_code: string
          organization_id: string
          snapshot: Json
        }
        Insert: {
          approved_at?: string
          approved_by: string
          home_id: string
          id?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          milestone_code: string
          organization_id: string
          snapshot: Json
        }
        Update: {
          approved_at?: string
          approved_by?: string
          home_id?: string
          id?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          milestone_code?: string
          organization_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "milestone_approvals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_approvals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_approvals_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "home_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "milestone_approvals_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      milestone_requirements: {
        Row: {
          home_id: string
          id: string
          milestone_code: string
          organization_id: string
          required: boolean
          required_inspection_type: Database["public"]["Enums"]["inspection_type"]
        }
        Insert: {
          home_id: string
          id?: string
          milestone_code: string
          organization_id: string
          required?: boolean
          required_inspection_type: Database["public"]["Enums"]["inspection_type"]
        }
        Update: {
          home_id?: string
          id?: string
          milestone_code?: string
          organization_id?: string
          required?: boolean
          required_inspection_type?: Database["public"]["Enums"]["inspection_type"]
        }
        Relationships: [
          {
            foreignKeyName: "milestone_requirements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_requirements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_requirements_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "home_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "milestone_requirements_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      neighborhood_trade_rosters: {
        Row: {
          active_from: string
          active_to: string | null
          authority_level: number
          company_id: string
          created_at: string
          granted_by: string | null
          id: string
          neighborhood_id: string
          organization_id: string
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
          version: number
        }
        Insert: {
          active_from?: string
          active_to?: string | null
          authority_level?: number
          company_id: string
          created_at?: string
          granted_by?: string | null
          id?: string
          neighborhood_id: string
          organization_id: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          active_from?: string
          active_to?: string | null
          authority_level?: number
          company_id?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          neighborhood_id?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "neighborhood_trade_rosters_organization_id_company_id_fkey"
            columns: ["organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "neighborhood_trade_rosters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "neighborhood_trade_rosters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "neighborhood_trade_rosters_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhood_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "neighborhood_trade_rosters_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      neighborhoods: {
        Row: {
          calendar_id: string | null
          code: string
          created_at: string
          division_id: string | null
          escalation_route_id: string | null
          id: string
          name: string
          organization_id: string
          status: Database["public"]["Enums"]["organization_status"]
          supervisor_user_id: string | null
          timezone: string | null
          updated_at: string
          version: number
        }
        Insert: {
          calendar_id?: string | null
          code: string
          created_at?: string
          division_id?: string | null
          escalation_route_id?: string | null
          id?: string
          name: string
          organization_id: string
          status?: Database["public"]["Enums"]["organization_status"]
          supervisor_user_id?: string | null
          timezone?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          calendar_id?: string | null
          code?: string
          created_at?: string
          division_id?: string | null
          escalation_route_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["organization_status"]
          supervisor_user_id?: string | null
          timezone?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "neighborhoods_calendar_fk"
            columns: ["organization_id", "calendar_id"]
            isOneToOne: false
            referencedRelation: "business_calendars"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "neighborhoods_organization_id_division_id_fkey"
            columns: ["organization_id", "division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "neighborhoods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "neighborhoods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          assignment_episode_id: string | null
          attempts: number
          available_at: string
          channel: string
          created_at: string
          dedupe_key: string
          id: string
          last_error: string | null
          lease_token: string | null
          leased_until: string | null
          max_attempts: number
          organization_id: string
          payload: Json
          provider_message_id: string | null
          recipient_user_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          template_key: string
          updated_at: string
          work_item_id: string | null
        }
        Insert: {
          assignment_episode_id?: string | null
          attempts?: number
          available_at?: string
          channel: string
          created_at?: string
          dedupe_key: string
          id?: string
          last_error?: string | null
          lease_token?: string | null
          leased_until?: string | null
          max_attempts?: number
          organization_id: string
          payload: Json
          provider_message_id?: string | null
          recipient_user_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          template_key: string
          updated_at?: string
          work_item_id?: string | null
        }
        Update: {
          assignment_episode_id?: string | null
          attempts?: number
          available_at?: string
          channel?: string
          created_at?: string
          dedupe_key?: string
          id?: string
          last_error?: string | null
          lease_token?: string | null
          leased_until?: string | null
          max_attempts?: number
          organization_id?: string
          payload?: Json
          provider_message_id?: string | null
          recipient_user_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          template_key?: string
          updated_at?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_organization_id_assignment_episode_id_fkey"
            columns: ["organization_id", "assignment_episode_id"]
            isOneToOne: false
            referencedRelation: "assignment_episodes"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "notification_outbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_item_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "notification_outbox_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      notification_rules: {
        Row: {
          business_minutes: number | null
          created_at: string
          enabled: boolean
          escalation_route_id: string
          id: string
          max_repeats: number
          neighborhood_id: string | null
          organization_id: string
          quiet_hours: Json
          repeat_minutes: number | null
          trigger: string
          updated_at: string
          version: number
        }
        Insert: {
          business_minutes?: number | null
          created_at?: string
          enabled?: boolean
          escalation_route_id: string
          id?: string
          max_repeats?: number
          neighborhood_id?: string | null
          organization_id: string
          quiet_hours?: Json
          repeat_minutes?: number | null
          trigger: string
          updated_at?: string
          version?: number
        }
        Update: {
          business_minutes?: number | null
          created_at?: string
          enabled?: boolean
          escalation_route_id?: string
          id?: string
          max_repeats?: number
          neighborhood_id?: string | null
          organization_id?: string
          quiet_hours?: Json
          repeat_minutes?: number | null
          trigger?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "notification_rules_organization_id_escalation_route_id_fkey"
            columns: ["organization_id", "escalation_route_id"]
            isOneToOne: false
            referencedRelation: "escalation_routes"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "notification_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_rules_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhood_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "notification_rules_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          deep_link: string
          id: string
          invalidated_at: string | null
          organization_id: string
          outbox_id: string | null
          read_at: string | null
          recipient_user_id: string
          title: string
          work_item_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          deep_link: string
          id?: string
          invalidated_at?: string | null
          organization_id: string
          outbox_id?: string | null
          read_at?: string | null
          recipient_user_id: string
          title: string
          work_item_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          deep_link?: string
          id?: string
          invalidated_at?: string | null
          organization_id?: string
          outbox_id?: string | null
          read_at?: string | null
          recipient_user_id?: string
          title?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_item_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "notifications_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "notifications_outbox_fk"
            columns: ["organization_id", "outbox_id"]
            isOneToOne: false
            referencedRelation: "notification_outbox"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          affiliation: Database["public"]["Enums"]["affiliation_kind"]
          created_at: string
          ended_at: string | null
          id: string
          joined_at: string | null
          organization_id: string
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          affiliation: Database["public"]["Enums"]["affiliation_kind"]
          created_at?: string
          ended_at?: string | null
          id?: string
          joined_at?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          affiliation?: Database["public"]["Enums"]["affiliation_kind"]
          created_at?: string
          ended_at?: string | null
          id?: string
          joined_at?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_onboarding: {
        Row: {
          administrator_email: string
          administrator_role_code: string
          created_at: string
          created_by: string
          organization_id: string
          request_id: string
        }
        Insert: {
          administrator_email: string
          administrator_role_code: string
          created_at?: string
          created_by: string
          organization_id: string
          request_id: string
        }
        Update: {
          administrator_email?: string
          administrator_role_code?: string
          created_at?: string
          created_by?: string
          organization_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_onboarding_administrator_role_code_fkey"
            columns: ["administrator_role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "organization_onboarding_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_onboarding_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_pricing: {
        Row: {
          base_rate: number
          billing_email: string
          billing_interval: string
          currency: string
          ends_on: string | null
          home_rate: number
          included_homes: number
          included_users: number
          notes: string
          organization_id: string
          plan_name: string
          starts_on: string
          subscription_status: string
          updated_at: string
          user_rate: number
          version: number
        }
        Insert: {
          base_rate?: number
          billing_email?: string
          billing_interval: string
          currency: string
          ends_on?: string | null
          home_rate?: number
          included_homes?: number
          included_users?: number
          notes?: string
          organization_id: string
          plan_name: string
          starts_on: string
          subscription_status: string
          updated_at?: string
          user_rate?: number
          version?: number
        }
        Update: {
          base_rate?: number
          billing_email?: string
          billing_interval?: string
          currency?: string
          ends_on?: string | null
          home_rate?: number
          included_homes?: number
          included_users?: number
          notes?: string
          organization_id?: string
          plan_name?: string
          starts_on?: string
          subscription_status?: string
          updated_at?: string
          user_rate?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_pricing_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_pricing_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_roles: {
        Row: {
          enabled: boolean
          organization_id: string
          role_code: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          organization_id: string
          role_code: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          organization_id?: string
          role_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_roles_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          default_calendar_id: string | null
          id: string
          name: string
          onboarding_status: string
          status: Database["public"]["Enums"]["organization_status"]
          timezone: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          default_calendar_id?: string | null
          id?: string
          name: string
          onboarding_status?: string
          status?: Database["public"]["Enums"]["organization_status"]
          timezone?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          default_calendar_id?: string | null
          id?: string
          name?: string
          onboarding_status?: string
          status?: Database["public"]["Enums"]["organization_status"]
          timezone?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organizations_calendar_fk"
            columns: ["id", "default_calendar_id"]
            isOneToOne: false
            referencedRelation: "business_calendars"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      permissions: {
        Row: {
          code: string
          description: string
        }
        Insert: {
          code: string
          description: string
        }
        Update: {
          code?: string
          description?: string
        }
        Relationships: []
      }
      platform_administrators: {
        Row: {
          active: boolean
          created_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          entity_id: string | null
          id: string
          organization_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          id?: string
          organization_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          id?: string
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          default_timezone: string
          singleton: boolean
          updated_at: string
          version: number
        }
        Insert: {
          default_timezone?: string
          singleton?: boolean
          updated_at?: string
          version?: number
        }
        Update: {
          default_timezone?: string
          singleton?: boolean
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          completed_at: string | null
          contact_email: string | null
          created_at: string
          display_name: string
          first_name: string
          id: string
          last_name: string
          phone_number: string | null
          preferred_locale: string
          timezone: string | null
          updated_at: string
          version: number
        }
        Insert: {
          completed_at?: string | null
          contact_email?: string | null
          created_at?: string
          display_name: string
          first_name?: string
          id: string
          last_name?: string
          phone_number?: string | null
          preferred_locale?: string
          timezone?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          completed_at?: string | null
          contact_email?: string | null
          created_at?: string
          display_name?: string
          first_name?: string
          id?: string
          last_name?: string
          phone_number?: string | null
          preferred_locale?: string
          timezone?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      project_conversation_members: {
        Row: {
          conversation_id: string
          joined_at: string
          last_read_seq: number
          organization_id: string
          removed_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string
          last_read_seq?: number
          organization_id: string
          removed_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string
          last_read_seq?: number
          organization_id?: string
          removed_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_conversation_members_organization_id_conversation__fkey"
            columns: ["organization_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "project_conversations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      project_conversations: {
        Row: {
          audience: string
          created_at: string
          created_by: string
          id: string
          organization_id: string
          request_hash: string
          request_id: string
          title: string
        }
        Insert: {
          audience?: string
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          request_hash: string
          request_id: string
          title: string
        }
        Update: {
          audience?: string
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          request_hash?: string
          request_id?: string
          title?: string
        }
        Relationships: []
      }
      project_messages: {
        Row: {
          author_id: string
          author_name: string
          body: string
          conversation_id: string
          created_at: string
          id: string
          kind: string
          operation_id: string
          organization_id: string
          reply_to: string | null
          seq: number
        }
        Insert: {
          author_id: string
          author_name: string
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          kind?: string
          operation_id: string
          organization_id: string
          reply_to?: string | null
          seq?: never
        }
        Update: {
          author_id?: string
          author_name?: string
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          kind?: string
          operation_id?: string
          organization_id?: string
          reply_to?: string | null
          seq?: never
        }
        Relationships: [
          {
            foreignKeyName: "project_messages_organization_id_conversation_id_fkey"
            columns: ["organization_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "project_conversations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "project_messages_organization_id_conversation_id_reply_to_fkey"
            columns: ["organization_id", "conversation_id", "reply_to"]
            isOneToOne: false
            referencedRelation: "project_messages"
            referencedColumns: ["organization_id", "conversation_id", "id"]
          },
        ]
      }
      role_assignments: {
        Row: {
          authority_level: number
          company_id: string | null
          created_at: string
          division_id: string | null
          ends_at: string | null
          granted_by: string
          home_id: string | null
          id: string
          neighborhood_id: string | null
          organization_id: string
          revoked_at: string | null
          role_code: string
          scope_kind: Database["public"]["Enums"]["scope_kind"]
          starts_at: string
          user_id: string
        }
        Insert: {
          authority_level?: number
          company_id?: string | null
          created_at?: string
          division_id?: string | null
          ends_at?: string | null
          granted_by: string
          home_id?: string | null
          id?: string
          neighborhood_id?: string | null
          organization_id: string
          revoked_at?: string | null
          role_code: string
          scope_kind: Database["public"]["Enums"]["scope_kind"]
          starts_at?: string
          user_id: string
        }
        Update: {
          authority_level?: number
          company_id?: string | null
          created_at?: string
          division_id?: string | null
          ends_at?: string | null
          granted_by?: string
          home_id?: string | null
          id?: string
          neighborhood_id?: string | null
          organization_id?: string
          revoked_at?: string | null
          role_code?: string
          scope_kind?: Database["public"]["Enums"]["scope_kind"]
          starts_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_assignments_organization_id_company_id_fkey"
            columns: ["organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "role_assignments_organization_id_division_id_fkey"
            columns: ["organization_id", "division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "role_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_assignments_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhood_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "role_assignments_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "role_assignments_organization_id_neighborhood_id_home_id_fkey"
            columns: ["organization_id", "neighborhood_id", "home_id"]
            isOneToOne: false
            referencedRelation: "home_summary"
            referencedColumns: ["organization_id", "neighborhood_id", "id"]
          },
          {
            foreignKeyName: "role_assignments_organization_id_neighborhood_id_home_id_fkey"
            columns: ["organization_id", "neighborhood_id", "home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["organization_id", "neighborhood_id", "id"]
          },
          {
            foreignKeyName: "role_assignments_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_code: string
          role_code: string
        }
        Insert: {
          permission_code: string
          role_code: string
        }
        Update: {
          permission_code?: string
          role_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "role_permissions_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      roles: {
        Row: {
          active: boolean
          allowed_scope_kinds: Database["public"]["Enums"]["scope_kind"][]
          code: string
          default_for_new_organizations: boolean
          description: string
          immutable_seed: boolean
          label: string
          organization_id: string | null
          release_state: string
          requires_company: boolean
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          allowed_scope_kinds: Database["public"]["Enums"]["scope_kind"][]
          code: string
          default_for_new_organizations?: boolean
          description?: string
          immutable_seed?: boolean
          label: string
          organization_id?: string | null
          release_state?: string
          requires_company?: boolean
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          allowed_scope_kinds?: Database["public"]["Enums"]["scope_kind"][]
          code?: string
          default_for_new_organizations?: boolean
          description?: string
          immutable_seed?: boolean
          label?: string
          organization_id?: string | null
          release_state?: string
          requires_company?: boolean
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      space_types: {
        Row: {
          active: boolean
          code: string
          label: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          code: string
          label: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          code?: string
          label?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      verifications: {
        Row: {
          correction_attempt_id: string
          created_at: string
          decision: string
          id: string
          method: string
          notes: string | null
          organization_id: string
          verified_at: string
          verified_by: string
        }
        Insert: {
          correction_attempt_id: string
          created_at?: string
          decision: string
          id?: string
          method: string
          notes?: string | null
          organization_id: string
          verified_at?: string
          verified_by: string
        }
        Update: {
          correction_attempt_id?: string
          created_at?: string
          decision?: string
          id?: string
          method?: string
          notes?: string | null
          organization_id?: string
          verified_at?: string
          verified_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "verifications_organization_id_correction_attempt_id_fkey"
            columns: ["organization_id", "correction_attempt_id"]
            isOneToOne: true
            referencedRelation: "correction_attempts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "verifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      work_events: {
        Row: {
          activity_order: number
          actor_id: string | null
          assignment_episode_id: string | null
          client_captured_at: string | null
          details: Json
          event_type: string
          from_state: Database["public"]["Enums"]["work_state"] | null
          id: string
          operation_id: string
          organization_id: string
          server_at: string
          to_state: Database["public"]["Enums"]["work_state"] | null
          work_item_id: string
        }
        Insert: {
          activity_order?: number
          actor_id?: string | null
          assignment_episode_id?: string | null
          client_captured_at?: string | null
          details?: Json
          event_type: string
          from_state?: Database["public"]["Enums"]["work_state"] | null
          id?: string
          operation_id: string
          organization_id: string
          server_at?: string
          to_state?: Database["public"]["Enums"]["work_state"] | null
          work_item_id: string
        }
        Update: {
          activity_order?: number
          actor_id?: string | null
          assignment_episode_id?: string | null
          client_captured_at?: string | null
          details?: Json
          event_type?: string
          from_state?: Database["public"]["Enums"]["work_state"] | null
          id?: string
          operation_id?: string
          organization_id?: string
          server_at?: string
          to_state?: Database["public"]["Enums"]["work_state"] | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_events_organization_id_assignment_episode_id_fkey"
            columns: ["organization_id", "assignment_episode_id"]
            isOneToOne: false
            referencedRelation: "assignment_episodes"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_events_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_item_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_events_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      work_items: {
        Row: {
          archived_at: string | null
          blocked_from_state: Database["public"]["Enums"]["work_state"] | null
          blocked_reason: string | null
          client_captured_at: string | null
          common_area_location: string | null
          created_at: string
          created_by: string
          current_assignment_id: string | null
          description: string
          due_at: string | null
          duplicate_of_id: string | null
          home_id: string | null
          id: string
          inspection_id: string | null
          location_id: string | null
          neighborhood_id: string
          observation_id: string | null
          organization_id: string
          origin: Database["public"]["Enums"]["work_origin"]
          priority: Database["public"]["Enums"]["work_priority"]
          reinspection_assigned_at: string | null
          reinspection_assigned_by: string | null
          reinspection_assignee_user_id: string | null
          reinspection_completed_at: string | null
          reinspection_status: string | null
          reopened_count: number
          safety_flag: boolean
          state: Database["public"]["Enums"]["work_state"]
          submitted_at: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          blocked_from_state?: Database["public"]["Enums"]["work_state"] | null
          blocked_reason?: string | null
          client_captured_at?: string | null
          common_area_location?: string | null
          created_at?: string
          created_by: string
          current_assignment_id?: string | null
          description: string
          due_at?: string | null
          duplicate_of_id?: string | null
          home_id?: string | null
          id?: string
          inspection_id?: string | null
          location_id?: string | null
          neighborhood_id: string
          observation_id?: string | null
          organization_id: string
          origin: Database["public"]["Enums"]["work_origin"]
          priority?: Database["public"]["Enums"]["work_priority"]
          reinspection_assigned_at?: string | null
          reinspection_assigned_by?: string | null
          reinspection_assignee_user_id?: string | null
          reinspection_completed_at?: string | null
          reinspection_status?: string | null
          reopened_count?: number
          safety_flag?: boolean
          state?: Database["public"]["Enums"]["work_state"]
          submitted_at?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          blocked_from_state?: Database["public"]["Enums"]["work_state"] | null
          blocked_reason?: string | null
          client_captured_at?: string | null
          common_area_location?: string | null
          created_at?: string
          created_by?: string
          current_assignment_id?: string | null
          description?: string
          due_at?: string | null
          duplicate_of_id?: string | null
          home_id?: string | null
          id?: string
          inspection_id?: string | null
          location_id?: string | null
          neighborhood_id?: string
          observation_id?: string | null
          organization_id?: string
          origin?: Database["public"]["Enums"]["work_origin"]
          priority?: Database["public"]["Enums"]["work_priority"]
          reinspection_assigned_at?: string | null
          reinspection_assigned_by?: string | null
          reinspection_assignee_user_id?: string | null
          reinspection_completed_at?: string | null
          reinspection_status?: string | null
          reopened_count?: number
          safety_flag?: boolean
          state?: Database["public"]["Enums"]["work_state"]
          submitted_at?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "work_items_current_assignment_fk"
            columns: ["organization_id", "id", "current_assignment_id"]
            isOneToOne: false
            referencedRelation: "assignment_episodes"
            referencedColumns: ["organization_id", "work_item_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_duplicate_of_id_fkey"
            columns: ["organization_id", "duplicate_of_id"]
            isOneToOne: false
            referencedRelation: "work_item_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_duplicate_of_id_fkey"
            columns: ["organization_id", "duplicate_of_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "home_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_home_id_location_id_fkey"
            columns: ["organization_id", "home_id", "location_id"]
            isOneToOne: false
            referencedRelation: "home_locations"
            referencedColumns: ["organization_id", "home_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspection_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhood_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_observation_id_fkey"
            columns: ["organization_id", "observation_id"]
            isOneToOne: false
            referencedRelation: "inspection_observations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
    }
    Views: {
      home_summary: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          archived_at: string | null
          city: string | null
          created_at: string | null
          external_reference: string | null
          id: string | null
          lot_code: string | null
          neighborhood_id: string | null
          open_count: number | null
          organization_id: string | null
          phase: string | null
          postal_code: string | null
          primary_supervisor_user_id: string | null
          readiness: string | null
          state_code: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          archived_at?: string | null
          city?: string | null
          created_at?: string | null
          external_reference?: string | null
          id?: string | null
          lot_code?: string | null
          neighborhood_id?: string | null
          open_count?: never
          organization_id?: string | null
          phase?: string | null
          postal_code?: string | null
          primary_supervisor_user_id?: string | null
          readiness?: never
          state_code?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          archived_at?: string | null
          city?: string | null
          created_at?: string | null
          external_reference?: string | null
          id?: string | null
          lot_code?: string | null
          neighborhood_id?: string | null
          open_count?: never
          organization_id?: string | null
          phase?: string | null
          postal_code?: string | null
          primary_supervisor_user_id?: string | null
          readiness?: never
          state_code?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "homes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homes_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhood_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "homes_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      inspection_list: {
        Row: {
          address_line1: string | null
          company_id: string | null
          current_revision: number | null
          escalated_at: string | null
          escalation_reason: string | null
          escalation_resolved_at: string | null
          home_id: string | null
          id: string | null
          lead_inspector_user_id: string | null
          lot_code: string | null
          neighborhood_id: string | null
          organization_id: string | null
          reviewed_at: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["inspection_status"] | null
          type: Database["public"]["Enums"]["inspection_type"] | null
          updated_at: string | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inspections_organization_id_company_id_fkey"
            columns: ["organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inspections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_organization_id_neighborhood_id_home_id_fkey"
            columns: ["organization_id", "neighborhood_id", "home_id"]
            isOneToOne: false
            referencedRelation: "home_summary"
            referencedColumns: ["organization_id", "neighborhood_id", "id"]
          },
          {
            foreignKeyName: "inspections_organization_id_neighborhood_id_home_id_fkey"
            columns: ["organization_id", "neighborhood_id", "home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["organization_id", "neighborhood_id", "id"]
          },
        ]
      }
      my_organizations: {
        Row: {
          id: string | null
          name: string | null
          status: Database["public"]["Enums"]["organization_status"] | null
          timezone: string | null
        }
        Relationships: []
      }
      neighborhood_summary: {
        Row: {
          calendar_id: string | null
          code: string | null
          created_at: string | null
          division_id: string | null
          escalation_route_id: string | null
          home_count: number | null
          id: string | null
          name: string | null
          open_count: number | null
          organization_id: string | null
          overdue_count: number | null
          status: Database["public"]["Enums"]["organization_status"] | null
          supervisor_user_id: string | null
          timezone: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          calendar_id?: string | null
          code?: string | null
          created_at?: string | null
          division_id?: string | null
          escalation_route_id?: string | null
          home_count?: never
          id?: string | null
          name?: string | null
          open_count?: never
          organization_id?: string | null
          overdue_count?: never
          status?: Database["public"]["Enums"]["organization_status"] | null
          supervisor_user_id?: string | null
          timezone?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          calendar_id?: string | null
          code?: string | null
          created_at?: string | null
          division_id?: string | null
          escalation_route_id?: string | null
          home_count?: never
          id?: string | null
          name?: string | null
          open_count?: never
          organization_id?: string | null
          overdue_count?: never
          status?: Database["public"]["Enums"]["organization_status"] | null
          supervisor_user_id?: string | null
          timezone?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "neighborhoods_calendar_fk"
            columns: ["organization_id", "calendar_id"]
            isOneToOne: false
            referencedRelation: "business_calendars"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "neighborhoods_organization_id_division_id_fkey"
            columns: ["organization_id", "division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "neighborhoods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "neighborhoods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_list: {
        Row: {
          address: string | null
          assigned_party_name: string | null
          created_at: string | null
          description: string | null
          due_at: string | null
          home_id: string | null
          id: string | null
          inspection_id: string | null
          location_id: string | null
          lot_code: string | null
          neighborhood_id: string | null
          organization_id: string | null
          priority: Database["public"]["Enums"]["work_priority"] | null
          reinspection_assigned_at: string | null
          reinspection_assignee_user_id: string | null
          reinspection_completed_at: string | null
          reinspection_status: string | null
          safety_flag: boolean | null
          state: Database["public"]["Enums"]["work_state"] | null
          title: string | null
          updated_at: string | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "my_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "home_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_home_id_fkey"
            columns: ["organization_id", "home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_home_id_location_id_fkey"
            columns: ["organization_id", "home_id", "location_id"]
            isOneToOne: false
            referencedRelation: "home_locations"
            referencedColumns: ["organization_id", "home_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspection_list"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_inspection_id_fkey"
            columns: ["organization_id", "inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhood_summary"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_neighborhood_id_fkey"
            columns: ["organization_id", "neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: { Args: { p_plaintext_token: string }; Returns: Json }
      admin_create_checklist_version: {
        Args: {
          p_organization_id: string
          p_questions: Json
          p_template_id: string
          p_template_name: string
        }
        Returns: Json
      }
      admin_create_invitation: {
        Args: {
          p_affiliation: Database["public"]["Enums"]["affiliation_kind"]
          p_company_id: string
          p_company_kind: string
          p_email: string
          p_expires_at: string
          p_grants: Json
          p_organization_id: string
          p_token_hash: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          authority_level: number
          created_at: string
          delivery_error: string | null
          expires_at: string
          id: string
          invited_by: string
          normalized_email: string
          organization_id: string
          proposed_company_id: string | null
          proposed_grants: Json
          proposed_membership: Json
          status: string
          token_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_list_invitations: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      admin_list_members: { Args: { p_organization_id: string }; Returns: Json }
      admin_onboard_vendor: {
        Args: {
          p_division_id?: string
          p_name: string
          p_neighborhood_id?: string
          p_organization_id: string
          p_reference: string
          p_scope: Database["public"]["Enums"]["scope_kind"]
        }
        Returns: {
          categories: string[]
          contact_email: string | null
          created_at: string
          created_by: string | null
          external_vendor_reference: string | null
          id: string
          name: string
          organization_id: string
          owner_authority_level: number
          owner_division_id: string | null
          owner_neighborhood_id: string | null
          owner_scope_kind: Database["public"]["Enums"]["scope_kind"]
          phone_number: string | null
          physical_address: string | null
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_publish_checklist_version: {
        Args: { p_organization_id: string; p_version_id: string }
        Returns: {
          created_at: string
          created_by: string
          id: string
          number: number
          organization_id: string
          published_at: string | null
          template_id: string
        }
        SetofOptions: {
          from: "*"
          to: "checklist_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_revoke_inspector_engagement: {
        Args: { p_id: string; p_organization_id: string }
        Returns: {
          created_at: string
          ends_at: string
          home_id: string
          id: string
          inspector_user_id: string
          neighborhood_id: string
          organization_id: string
          purpose: string
          revoked_at: string | null
          starts_at: string
        }
        SetofOptions: {
          from: "*"
          to: "inspection_engagements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_revoke_invitation: {
        Args: { p_invitation_id: string; p_organization_id: string }
        Returns: Json
      }
      admin_save_business_calendar: {
        Args: {
          p_holiday_dates?: string[]
          p_id: string
          p_local_end_time: string
          p_local_start_time: string
          p_name: string
          p_organization_id: string
          p_timezone: string
          p_working_weekdays: number[]
        }
        Returns: {
          created_at: string
          holiday_dates: string[]
          id: string
          local_end_time: string
          local_start_time: string
          name: string
          organization_id: string
          timezone: string
          updated_at: string
          version: number
          working_weekdays: number[]
        }
        SetofOptions: {
          from: "*"
          to: "business_calendars"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_company: {
        Args: {
          p_external_vendor_reference?: string
          p_id: string
          p_name: string
          p_organization_id: string
          p_status?: Database["public"]["Enums"]["organization_status"]
        }
        Returns: {
          categories: string[]
          contact_email: string | null
          created_at: string
          created_by: string | null
          external_vendor_reference: string | null
          id: string
          name: string
          organization_id: string
          owner_authority_level: number
          owner_division_id: string | null
          owner_neighborhood_id: string | null
          owner_scope_kind: Database["public"]["Enums"]["scope_kind"]
          phone_number: string | null
          physical_address: string | null
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_division: {
        Args: {
          p_id: string
          p_name: string
          p_organization_id: string
          p_status?: Database["public"]["Enums"]["organization_status"]
        }
        Returns: {
          created_at: string
          id: string
          name: string
          organization_id: string
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "divisions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_escalation_route: {
        Args: {
          p_active: boolean
          p_id: string
          p_name: string
          p_organization_id: string
          p_steps: Json
        }
        Returns: Json
      }
      admin_save_home: {
        Args: {
          p_address_line1?: string
          p_address_line2?: string
          p_archived?: boolean
          p_city?: string
          p_external_reference?: string
          p_id: string
          p_lot_code: string
          p_neighborhood_id: string
          p_organization_id: string
          p_phase?: string
          p_postal_code?: string
          p_primary_supervisor_user_id?: string
          p_state_code?: string
        }
        Returns: {
          address_line1: string | null
          address_line2: string | null
          archived_at: string | null
          city: string | null
          created_at: string
          external_reference: string | null
          id: string
          layout_mode: string
          lot_code: string
          master_plan_id: string | null
          master_plan_name: string | null
          master_plan_version: number | null
          neighborhood_id: string
          organization_id: string
          phase: string
          postal_code: string | null
          primary_supervisor_user_id: string | null
          state_code: string | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "homes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_home_location: {
        Args: {
          p_active?: boolean
          p_home_id: string
          p_id: string
          p_name: string
          p_organization_id: string
          p_parent_location_id?: string
        }
        Returns: {
          active: boolean
          created_at: string
          home_id: string
          id: string
          level: string | null
          name: string
          neighborhood_id: string
          organization_id: string
          parent_location_id: string | null
          source_plan_id: string | null
          space_type_code: string | null
          square_feet: number | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "home_locations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_home_milestone: {
        Args: {
          p_home_id: string
          p_id: string
          p_milestone_code: string
          p_organization_id: string
          p_planned_at?: string
        }
        Returns: {
          actual_at: string | null
          created_at: string
          home_id: string
          id: string
          milestone_code: string
          organization_id: string
          planned_at: string | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "home_milestones"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_inspector_engagement: {
        Args: {
          p_ends_at: string
          p_home_id: string
          p_id: string
          p_inspector_user_id: string
          p_neighborhood_id: string
          p_organization_id: string
          p_purpose: string
          p_revoke?: boolean
          p_starts_at: string
        }
        Returns: {
          created_at: string
          ends_at: string
          home_id: string
          id: string
          inspector_user_id: string
          neighborhood_id: string
          organization_id: string
          purpose: string
          revoked_at: string | null
          starts_at: string
        }
        SetofOptions: {
          from: "*"
          to: "inspection_engagements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_milestone_requirement: {
        Args: {
          p_home_id: string
          p_id: string
          p_milestone_code: string
          p_organization_id: string
          p_required?: boolean
          p_required_inspection_type: Database["public"]["Enums"]["inspection_type"]
        }
        Returns: {
          home_id: string
          id: string
          milestone_code: string
          organization_id: string
          required: boolean
          required_inspection_type: Database["public"]["Enums"]["inspection_type"]
        }
        SetofOptions: {
          from: "*"
          to: "milestone_requirements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_neighborhood: {
        Args: {
          p_code: string
          p_division_id: string
          p_id: string
          p_name: string
          p_organization_id: string
          p_status?: Database["public"]["Enums"]["organization_status"]
          p_supervisor_user_id?: string
          p_timezone?: string
        }
        Returns: {
          calendar_id: string | null
          code: string
          created_at: string
          division_id: string | null
          escalation_route_id: string | null
          id: string
          name: string
          organization_id: string
          status: Database["public"]["Enums"]["organization_status"]
          supervisor_user_id: string | null
          timezone: string | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "neighborhoods"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_notification_rule: {
        Args: {
          p_business_minutes: number
          p_enabled: boolean
          p_escalation_route_id: string
          p_id: string
          p_max_repeats: number
          p_neighborhood_id: string
          p_organization_id: string
          p_quiet_hours: Json
          p_repeat_minutes: number
          p_trigger: string
        }
        Returns: {
          business_minutes: number | null
          created_at: string
          enabled: boolean
          escalation_route_id: string
          id: string
          max_repeats: number
          neighborhood_id: string | null
          organization_id: string
          quiet_hours: Json
          repeat_minutes: number | null
          trigger: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "notification_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_roster: {
        Args: {
          p_active_from?: string
          p_active_to?: string
          p_company_id: string
          p_id: string
          p_neighborhood_id: string
          p_organization_id: string
          p_status?: Database["public"]["Enums"]["organization_status"]
        }
        Returns: {
          active_from: string
          active_to: string | null
          authority_level: number
          company_id: string
          created_at: string
          granted_by: string | null
          id: string
          neighborhood_id: string
          organization_id: string
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "neighborhood_trade_rosters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_catalog_status: {
        Args: {
          p_active: boolean
          p_entity: string
          p_id: string
          p_organization_id: string
        }
        Returns: Json
      }
      admin_set_member_access: {
        Args: {
          p_affiliation: Database["public"]["Enums"]["affiliation_kind"]
          p_assignments: Json
          p_company_id?: string
          p_company_kind?: string
          p_organization_id: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_set_vendor_coverage: {
        Args: {
          p_active?: boolean
          p_company_id: string
          p_division_id?: string
          p_grant_id?: string
          p_neighborhood_id?: string
          p_organization_id: string
          p_scope: Database["public"]["Enums"]["scope_kind"]
        }
        Returns: Json
      }
      admin_suspend_member: {
        Args: { p_organization_id: string; p_reason: string; p_user_id: string }
        Returns: Json
      }
      administration_context: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      apply_home_plan: {
        Args: {
          p_home: string
          p_home_version: number
          p_org: string
          p_plan: string
        }
        Returns: Json
      }
      available_roles: { Args: { p_organization_id: string }; Returns: Json }
      bootstrap_organization: {
        Args: { p_admin_user_id: string; p_name: string; p_timezone: string }
        Returns: string
      }
      claim_notification_batch: {
        Args: { p_lease_token: string; p_limit: number }
        Returns: {
          assignment_episode_id: string | null
          attempts: number
          available_at: string
          channel: string
          created_at: string
          dedupe_key: string
          id: string
          last_error: string | null
          lease_token: string | null
          leased_until: string | null
          max_attempts: number
          organization_id: string
          payload: Json
          provider_message_id: string | null
          recipient_user_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          template_key: string
          updated_at: string
          work_item_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      company_delegation_options: {
        Args: { p_organization_id: string; p_work_item_id: string }
        Returns: Json
      }
      company_profile_context: {
        Args: { p_company: string; p_org: string }
        Returns: Json
      }
      complete_export_job: {
        Args: {
          p_error: string
          p_job_id: string
          p_object_key: string
          p_row_count: number
          p_status: string
        }
        Returns: undefined
      }
      complete_notification: {
        Args: {
          p_id: string
          p_lease_token: string
          p_provider_message_id: string
        }
        Returns: undefined
      }
      create_export_job: {
        Args: {
          p_export_kind: string
          p_filters: Json
          p_organization_id: string
        }
        Returns: {
          bucket: string
          created_at: string
          error_message: string | null
          expires_at: string | null
          export_kind: string
          filters: Json
          id: string
          object_key: string | null
          organization_id: string
          requested_by: string
          row_count: number | null
          status: string
          storage_deleted_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "export_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_access: { Args: { p_organization_id: string }; Returns: Json }
      execute_command: {
        Args: { p_command_name: string; p_envelope: Json }
        Returns: Json
      }
      execute_command_before_plan_checklists: {
        Args: { p_command_name: string; p_envelope: Json }
        Returns: Json
      }
      fail_notification: {
        Args: {
          p_error: string
          p_id: string
          p_lease_token: string
          p_retryable: boolean
        }
        Returns: undefined
      }
      finalize_attachment_record: {
        Args: {
          p_actual_mime: string
          p_actual_size: number
          p_attachment_id: string
          p_clean: boolean
          p_derivative_object_key?: string
          p_provider_reference: string
          p_rejection_reason?: string
          p_sha256: string
        }
        Returns: {
          activity_order: number
          bucket: string
          byte_size: number
          client_operation_id: string | null
          comment_id: string | null
          correction_attempt_id: string | null
          created_at: string
          derivative_object_key: string | null
          home_id: string | null
          id: string
          inspection_id: string | null
          mime_type: string
          neighborhood_id: string
          object_key: string
          organization_id: string
          original_name: string
          purpose: string
          ready_at: string | null
          rejection_reason: string | null
          scan_provider: string | null
          scan_reference: string | null
          sha256: string | null
          status: Database["public"]["Enums"]["attachment_status"]
          storage_deleted_at: string | null
          uploader_id: string
          visibility: Database["public"]["Enums"]["comment_visibility"]
          work_item_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_dashboard_metrics: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      get_report_metrics: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      inspection_allocation_options: {
        Args: { p_inspection_id: string; p_organization_id: string }
        Returns: Json
      }
      inspection_company_options: {
        Args: { p_home_id: string; p_organization_id: string }
        Returns: Json
      }
      inspection_lead_options: {
        Args: { p_home_id: string; p_organization_id: string }
        Returns: {
          display_name: string
          role_label: string
          user_id: string
        }[]
      }
      inspection_repair_readiness: {
        Args: { p_home?: string; p_org: string }
        Returns: {
          address_line1: string
          home_id: string
          incomplete_count: number
          lot_code: string
          observation_count: number
          ready_for_reinspection: boolean
          repair_count: number
          unreviewed_count: number
        }[]
      }
      invitation_identity_exists: {
        Args: { p_email: string }
        Returns: boolean
      }
      manage_role_catalog: {
        Args: { p_organization_id?: string }
        Returns: Json
      }
      mark_attachment_quarantined: {
        Args: { p_attachment_id: string }
        Returns: {
          activity_order: number
          bucket: string
          byte_size: number
          client_operation_id: string | null
          comment_id: string | null
          correction_attempt_id: string | null
          created_at: string
          derivative_object_key: string | null
          home_id: string | null
          id: string
          inspection_id: string | null
          mime_type: string
          neighborhood_id: string
          object_key: string
          organization_id: string
          original_name: string
          purpose: string
          ready_at: string | null
          rejection_reason: string | null
          scan_provider: string | null
          scan_reference: string | null
          sha256: string | null
          status: Database["public"]["Enums"]["attachment_status"]
          storage_deleted_at: string | null
          uploader_id: string
          visibility: Database["public"]["Enums"]["comment_visibility"]
          work_item_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      my_profile: { Args: never; Returns: Json }
      observation_activity: {
        Args: {
          p_before_at?: string
          p_before_key?: string
          p_item: string
          p_org: string
        }
        Returns: Json
      }
      onboard_home_layout: {
        Args: {
          p_details: Json
          p_mode: string
          p_org: string
          p_plan: string
          p_request: string
          p_spaces: Json
        }
        Returns: Json
      }
      onboard_home_with_plan: {
        Args: { p_details: Json; p_org: string; p_plan: string }
        Returns: Json
      }
      onboard_vendor_with_profile: {
        Args: {
          p_division: string
          p_name: string
          p_neighborhood: string
          p_org: string
          p_profile: Json
          p_reference: string
          p_scope: Database["public"]["Enums"]["scope_kind"]
        }
        Returns: Json
      }
      participant_directory: {
        Args: { p_neighborhood_id?: string; p_organization_id: string }
        Returns: {
          affiliation: Database["public"]["Enums"]["affiliation_kind"]
          display_name: string
          user_id: string
        }[]
      }
      platform_access: { Args: never; Returns: Json }
      platform_get_configuration: { Args: never; Returns: Json }
      platform_get_operations: {
        Args: { p_organization_id: string; p_page?: number; p_search?: string }
        Returns: Json
      }
      platform_get_organization: { Args: { p_id: string }; Returns: Json }
      platform_get_provider: {
        Args: {
          p_company: string
          p_coverage_page?: number
          p_member_page?: number
          p_org: string
        }
        Returns: Json
      }
      platform_list_organizations: {
        Args: { p_page?: number; p_search?: string; p_status?: string }
        Returns: Json
      }
      platform_list_providers: {
        Args: { p_org: string; p_page?: number; p_search?: string }
        Returns: Json
      }
      platform_prepare_administrator_invitation: {
        Args: {
          p_expires_at: string
          p_organization_id: string
          p_token_hash: string
        }
        Returns: Json
      }
      platform_prepare_member_invitation: {
        Args: {
          p_email: string
          p_expires_at: string
          p_organization_id: string
          p_role_code: string
          p_token_hash: string
        }
        Returns: Json
      }
      platform_revoke_invitation: {
        Args: {
          p_invitation_id: string
          p_organization_id: string
          p_reason: string
        }
        Returns: undefined
      }
      platform_save_catalog_entry: {
        Args: {
          p_active: boolean
          p_code: string
          p_kind: string
          p_label: string
          p_sort_order: number
          p_version?: number
        }
        Returns: Json
      }
      platform_save_organization: {
        Args: {
          p_administrator_email: string
          p_administrator_role_code: string
          p_expected_version?: number
          p_id: string
          p_name: string
          p_request_id: string
          p_status: Database["public"]["Enums"]["organization_status"]
          p_timezone: string
        }
        Returns: Json
      }
      platform_save_pricing: {
        Args: {
          p_config: Json
          p_expected_version?: number
          p_organization_id: string
        }
        Returns: Json
      }
      platform_save_settings: {
        Args: { p_timezone: string; p_version: number }
        Returns: Json
      }
      platform_set_member_status: {
        Args: {
          p_expected_status: Database["public"]["Enums"]["membership_status"]
          p_organization_id: string
          p_reason: string
          p_status: Database["public"]["Enums"]["membership_status"]
          p_user_id: string
        }
        Returns: Json
      }
      platform_set_organization_status: {
        Args: {
          p_expected_version: number
          p_organization_id: string
          p_reason: string
          p_status: Database["public"]["Enums"]["organization_status"]
        }
        Returns: Json
      }
      project_chat_create: {
        Args: {
          p_audience?: string
          p_org: string
          p_request: string
          p_title: string
          p_users: string[]
        }
        Returns: string
      }
      project_chat_inbox: {
        Args: { p_org: string; p_page?: number; p_search?: string }
        Returns: Json
      }
      project_chat_mark_read: {
        Args: { p_conversation: string; p_org: string; p_seq: number }
        Returns: undefined
      }
      project_chat_people: {
        Args: { p_audience?: string; p_org: string }
        Returns: Json
      }
      project_chat_read: {
        Args: { p_before?: number; p_conversation: string; p_org: string }
        Returns: Json
      }
      project_chat_set_member: {
        Args: {
          p_active: boolean
          p_conversation: string
          p_org: string
          p_user: string
        }
        Returns: undefined
      }
      repair_technician_options: {
        Args: { p_company: string; p_home: string; p_org: string }
        Returns: Json
      }
      request_attachment_slot: {
        Args: {
          p_byte_size: number
          p_comment_id: string
          p_home_id: string
          p_inspection_id: string
          p_mime_type: string
          p_neighborhood_id: string
          p_organization_id: string
          p_original_name: string
          p_purpose: string
          p_visibility: Database["public"]["Enums"]["comment_visibility"]
          p_work_item_id: string
        }
        Returns: {
          activity_order: number
          bucket: string
          byte_size: number
          client_operation_id: string | null
          comment_id: string | null
          correction_attempt_id: string | null
          created_at: string
          derivative_object_key: string | null
          home_id: string | null
          id: string
          inspection_id: string | null
          mime_type: string
          neighborhood_id: string
          object_key: string
          organization_id: string
          original_name: string
          purpose: string
          ready_at: string | null
          rejection_reason: string | null
          scan_provider: string | null
          scan_reference: string | null
          sha256: string | null
          status: Database["public"]["Enums"]["attachment_status"]
          storage_deleted_at: string | null
          uploader_id: string
          visibility: Database["public"]["Enums"]["comment_visibility"]
          work_item_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_offline_work_attachment_slot: {
        Args: {
          p_byte_size: number
          p_home_id: string
          p_mime_type: string
          p_neighborhood_id: string
          p_operation_id: string
          p_organization_id: string
          p_original_name: string
          p_purpose: string
          p_visibility: Database["public"]["Enums"]["comment_visibility"]
          p_work_item_id: string
        }
        Returns: {
          activity_order: number
          bucket: string
          byte_size: number
          client_operation_id: string | null
          comment_id: string | null
          correction_attempt_id: string | null
          created_at: string
          derivative_object_key: string | null
          home_id: string | null
          id: string
          inspection_id: string | null
          mime_type: string
          neighborhood_id: string
          object_key: string
          organization_id: string
          original_name: string
          purpose: string
          ready_at: string | null
          rejection_reason: string | null
          scan_provider: string | null
          scan_reference: string | null
          sha256: string | null
          status: Database["public"]["Enums"]["attachment_status"]
          storage_deleted_at: string | null
          uploader_id: string
          visibility: Database["public"]["Enums"]["comment_visibility"]
          work_item_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      run_notification_scheduler: { Args: never; Returns: number }
      run_scheduled_cleanup: { Args: never; Returns: Json }
      save_company_profile: {
        Args: {
          p_address: string
          p_categories: string[]
          p_company: string
          p_ein: string
          p_email: string
          p_org: string
          p_phone: string
          p_version: number
        }
        Returns: Json
      }
      save_home_space:
        | {
            Args: {
              p_active: boolean
              p_home: string
              p_id: string
              p_name: string
              p_org: string
              p_parent: string
              p_type: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_active: boolean
              p_home: string
              p_id: string
              p_level: string
              p_name: string
              p_org: string
              p_parent: string
              p_square_feet: number
              p_type: string
            }
            Returns: Json
          }
      save_master_plan: {
        Args: {
          p_active: boolean
          p_division: string
          p_id: string
          p_levels?: number
          p_name: string
          p_org: string
          p_spaces: Json
          p_version?: number
        }
        Returns: Json
      }
      save_my_profile: {
        Args: {
          p_contact_email?: string
          p_expected_version?: number
          p_first_name: string
          p_last_name: string
          p_phone_number?: string
          p_timezone?: string
        }
        Returns: Json
      }
      save_role_definition: {
        Args: {
          p_active: boolean
          p_code: string
          p_default: boolean
          p_description: string
          p_expected_version?: number
          p_label: string
          p_organization_id: string
          p_permissions: string[]
          p_requires_company: boolean
          p_scopes: Database["public"]["Enums"]["scope_kind"][]
        }
        Returns: Json
      }
      set_organization_role: {
        Args: {
          p_enabled: boolean
          p_organization_id: string
          p_role_code: string
        }
        Returns: Json
      }
      update_my_profile: {
        Args: {
          p_display_name: string
          p_preferred_locale?: string
          p_timezone?: string
        }
        Returns: {
          completed_at: string | null
          contact_email: string | null
          created_at: string
          display_name: string
          first_name: string
          id: string
          last_name: string
          phone_number: string | null
          preferred_locale: string
          timezone: string | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      vendor_access_context: {
        Args: { p_company_id: string; p_organization_id: string }
        Returns: Json
      }
      workspace_defaults: { Args: never; Returns: Json }
    }
    Enums: {
      affiliation_kind: "internal" | "external"
      attachment_status:
        | "pending_upload"
        | "quarantined"
        | "ready"
        | "rejected"
        | "deleted"
      comment_visibility: "shared" | "internal"
      inspection_result: "pass" | "fail" | "not_applicable" | "not_checked"
      inspection_status:
        | "draft"
        | "in_progress"
        | "submitted"
        | "amended"
        | "cancelled"
      inspection_type:
        | "internal_quality"
        | "external_quality"
        | "pre_walkthrough"
        | "final_walkthrough"
        | "reinspection"
      membership_status: "invited" | "active" | "suspended" | "removed"
      notification_status:
        | "pending"
        | "leased"
        | "sent"
        | "failed"
        | "dead"
        | "cancelled"
      organization_status: "active" | "suspended" | "archived"
      scope_kind:
        | "organization"
        | "neighborhood"
        | "home"
        | "division"
        | "company"
      work_origin:
        | "internal_observation"
        | "internal_inspection"
        | "external_inspection"
        | "walkthrough"
        | "manual_report"
      work_priority: "low" | "normal" | "high" | "critical"
      work_state:
        | "draft"
        | "submitted"
        | "assigned"
        | "acknowledged"
        | "in_progress"
        | "blocked"
        | "ready_for_verification"
        | "rework_required"
        | "verified"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      affiliation_kind: ["internal", "external"],
      attachment_status: [
        "pending_upload",
        "quarantined",
        "ready",
        "rejected",
        "deleted",
      ],
      comment_visibility: ["shared", "internal"],
      inspection_result: ["pass", "fail", "not_applicable", "not_checked"],
      inspection_status: [
        "draft",
        "in_progress",
        "submitted",
        "amended",
        "cancelled",
      ],
      inspection_type: [
        "internal_quality",
        "external_quality",
        "pre_walkthrough",
        "final_walkthrough",
        "reinspection",
      ],
      membership_status: ["invited", "active", "suspended", "removed"],
      notification_status: [
        "pending",
        "leased",
        "sent",
        "failed",
        "dead",
        "cancelled",
      ],
      organization_status: ["active", "suspended", "archived"],
      scope_kind: [
        "organization",
        "neighborhood",
        "home",
        "division",
        "company",
      ],
      work_origin: [
        "internal_observation",
        "internal_inspection",
        "external_inspection",
        "walkthrough",
        "manual_report",
      ],
      work_priority: ["low", "normal", "high", "critical"],
      work_state: [
        "draft",
        "submitted",
        "assigned",
        "acknowledged",
        "in_progress",
        "blocked",
        "ready_for_verification",
        "rework_required",
        "verified",
        "cancelled",
      ],
    },
  },
} as const
