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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_super_admins: {
        Row: {
          created_at: string
          granted_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      billing_applications: {
        Row: {
          amount_billed: number
          application_number: string
          billing_period: string
          change_order_amount: number
          contract_amount: number
          created_at: string
          due_date: string | null
          has_line_detail: boolean
          id: string
          invoice_number: string
          notes: string
          paid_to_date: number
          project_id: string
          retainage: number
          retainage_released_this_period: number
          sort_order: number
          status: string
          submitted_date: string | null
          total_retainage_held: number
          updated_at: string
        }
        Insert: {
          amount_billed?: number
          application_number?: string
          billing_period?: string
          change_order_amount?: number
          contract_amount?: number
          created_at?: string
          due_date?: string | null
          has_line_detail?: boolean
          id?: string
          invoice_number?: string
          notes?: string
          paid_to_date?: number
          project_id: string
          retainage?: number
          retainage_released_this_period?: number
          sort_order?: number
          status?: string
          submitted_date?: string | null
          total_retainage_held?: number
          updated_at?: string
        }
        Update: {
          amount_billed?: number
          application_number?: string
          billing_period?: string
          change_order_amount?: number
          contract_amount?: number
          created_at?: string
          due_date?: string | null
          has_line_detail?: boolean
          id?: string
          invoice_number?: string
          notes?: string
          paid_to_date?: number
          project_id?: string
          retainage?: number
          retainage_released_this_period?: number
          sort_order?: number
          status?: string
          submitted_date?: string | null
          total_retainage_held?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_applications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_invoices: {
        Row: {
          billing_application_id: string | null
          client_visible: boolean
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          invoice_number: string
          issue_date: string | null
          notes: string
          paid_amount: number
          paid_at: string | null
          project_id: string
          retainage: number
          sent_at: string | null
          status: string
          subtotal: number
          title: string
          total_due: number
          updated_at: string
        }
        Insert: {
          billing_application_id?: string | null
          client_visible?: boolean
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string | null
          notes?: string
          paid_amount?: number
          paid_at?: string | null
          project_id: string
          retainage?: number
          sent_at?: string | null
          status?: string
          subtotal?: number
          title?: string
          total_due?: number
          updated_at?: string
        }
        Update: {
          billing_application_id?: string | null
          client_visible?: boolean
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string | null
          notes?: string
          paid_amount?: number
          paid_at?: string | null
          project_id?: string
          retainage?: number
          sent_at?: string | null
          status?: string
          subtotal?: number
          title?: string
          total_due?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoices_billing_application_id_fkey"
            columns: ["billing_application_id"]
            isOneToOne: false
            referencedRelation: "billing_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_line_items: {
        Row: {
          balance_to_finish_cents: number | null
          billing_application_id: string
          billing_method: string
          billing_percent_complete: number | null
          change_order_value_cents: number
          cost_bucket_id: string | null
          cost_code: string
          created_at: string
          description: string
          id: string
          materials_stored_previous_cents: number
          materials_stored_this_period_cents: number
          materials_stored_to_date_cents: number | null
          project_id: string
          retainage_held_cents: number | null
          retainage_pct: number
          retainage_released_cents: number
          scheduled_value_cents: number
          sort_order: number
          total_completed_and_stored_cents: number | null
          updated_at: string
          work_completed_previous_cents: number
          work_completed_this_period_cents: number
          work_completed_to_date_cents: number | null
        }
        Insert: {
          balance_to_finish_cents?: number | null
          billing_application_id: string
          billing_method?: string
          billing_percent_complete?: number | null
          change_order_value_cents?: number
          cost_bucket_id?: string | null
          cost_code?: string
          created_at?: string
          description: string
          id?: string
          materials_stored_previous_cents?: number
          materials_stored_this_period_cents?: number
          materials_stored_to_date_cents?: number | null
          project_id: string
          retainage_held_cents?: number | null
          retainage_pct?: number
          retainage_released_cents?: number
          scheduled_value_cents?: number
          sort_order?: number
          total_completed_and_stored_cents?: number | null
          updated_at?: string
          work_completed_previous_cents?: number
          work_completed_this_period_cents?: number
          work_completed_to_date_cents?: number | null
        }
        Update: {
          balance_to_finish_cents?: number | null
          billing_application_id?: string
          billing_method?: string
          billing_percent_complete?: number | null
          change_order_value_cents?: number
          cost_bucket_id?: string | null
          cost_code?: string
          created_at?: string
          description?: string
          id?: string
          materials_stored_previous_cents?: number
          materials_stored_this_period_cents?: number
          materials_stored_to_date_cents?: number | null
          project_id?: string
          retainage_held_cents?: number | null
          retainage_pct?: number
          retainage_released_cents?: number
          scheduled_value_cents?: number
          sort_order?: number
          total_completed_and_stored_cents?: number | null
          updated_at?: string
          work_completed_previous_cents?: number
          work_completed_this_period_cents?: number
          work_completed_to_date_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_line_items_billing_application_id_fkey"
            columns: ["billing_application_id"]
            isOneToOne: false
            referencedRelation: "billing_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_line_items_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_line_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      change_order_allocations: {
        Row: {
          change_order_id: string
          contract_amount: number
          cost_amount: number
          cost_bucket_id: string | null
          cost_code: string
          created_at: string
          description: string
          id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          change_order_id: string
          contract_amount?: number
          cost_amount?: number
          cost_bucket_id?: string | null
          cost_code?: string
          created_at?: string
          description?: string
          id?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          change_order_id?: string
          contract_amount?: number
          cost_amount?: number
          cost_bucket_id?: string | null
          cost_code?: string
          created_at?: string
          description?: string
          id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_order_allocations_change_order_id_fkey"
            columns: ["change_order_id"]
            isOneToOne: false
            referencedRelation: "change_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_order_allocations_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_order_allocations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      change_order_approvals: {
        Row: {
          change_order_id: string
          client_email: string
          client_user_id: string | null
          contact_id: string | null
          created_at: string
          decision: Database["public"]["Enums"]["client_approval_decision"]
          document_version: string
          id: string
          notes: string
          project_id: string
          user_agent: string
        }
        Insert: {
          change_order_id: string
          client_email?: string
          client_user_id?: string | null
          contact_id?: string | null
          created_at?: string
          decision: Database["public"]["Enums"]["client_approval_decision"]
          document_version?: string
          id?: string
          notes?: string
          project_id: string
          user_agent?: string
        }
        Update: {
          change_order_id?: string
          client_email?: string
          client_user_id?: string | null
          contact_id?: string | null
          created_at?: string
          decision?: Database["public"]["Enums"]["client_approval_decision"]
          document_version?: string
          id?: string
          notes?: string
          project_id?: string
          user_agent?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_order_approvals_change_order_id_fkey"
            columns: ["change_order_id"]
            isOneToOne: false
            referencedRelation: "change_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_order_approvals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_order_approvals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      change_orders: {
        Row: {
          client_decided_at: string | null
          client_notes: string
          client_sent_at: string | null
          client_status: Database["public"]["Enums"]["client_change_order_status"]
          client_visible: boolean
          co_type: string
          contract_amount: number
          cost_amount: number
          created_at: string
          description: string
          id: string
          notes: string
          number: string
          owner: string
          probability: number
          project_id: string
          status: string
          updated_at: string
        }
        Insert: {
          client_decided_at?: string | null
          client_notes?: string
          client_sent_at?: string | null
          client_status?: Database["public"]["Enums"]["client_change_order_status"]
          client_visible?: boolean
          co_type?: string
          contract_amount?: number
          cost_amount?: number
          created_at?: string
          description?: string
          id?: string
          notes?: string
          number?: string
          owner?: string
          probability?: number
          project_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          client_decided_at?: string | null
          client_notes?: string
          client_sent_at?: string | null
          client_status?: Database["public"]["Enums"]["client_change_order_status"]
          client_visible?: boolean
          co_type?: string
          contract_amount?: number
          cost_amount?: number
          created_at?: string
          description?: string
          id?: string
          notes?: string
          number?: string
          owner?: string
          probability?: number
          project_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contacts: {
        Row: {
          company: string
          created_at: string
          created_by: string | null
          email: string
          id: string
          name: string
          notes: string
          organization_id: string
          phone: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          company?: string
          created_at?: string
          created_by?: string | null
          email: string
          id?: string
          name?: string
          notes?: string
          organization_id: string
          phone?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          company?: string
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          name?: string
          notes?: string
          organization_id?: string
          phone?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_actual_import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          file_hash: string
          id: string
          matched_count: number
          project_id: string
          row_count: number
          source_name: string
          source_type: string
          status: string
          unmatched_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_hash?: string
          id?: string
          matched_count?: number
          project_id: string
          row_count?: number
          source_name?: string
          source_type?: string
          status?: string
          unmatched_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_hash?: string
          id?: string
          matched_count?: number
          project_id?: string
          row_count?: number
          source_name?: string
          source_type?: string
          status?: string
          unmatched_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "cost_actual_import_batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_actuals: {
        Row: {
          amount: number
          category: string
          cost_bucket_id: string | null
          cost_code: string
          cost_date: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          import_batch_id: string | null
          notes: string
          project_id: string
          reference_number: string
          source_external_id: string
          source_row_hash: string
          status: string
          updated_at: string
          vendor: string
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount?: number
          category?: string
          cost_bucket_id?: string | null
          cost_code?: string
          cost_date: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          import_batch_id?: string | null
          notes?: string
          project_id: string
          reference_number?: string
          source_external_id?: string
          source_row_hash?: string
          status?: string
          updated_at?: string
          vendor?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          category?: string
          cost_bucket_id?: string | null
          cost_code?: string
          cost_date?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          import_batch_id?: string | null
          notes?: string
          project_id?: string
          reference_number?: string
          source_external_id?: string
          source_row_hash?: string
          status?: string
          updated_at?: string
          vendor?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_actuals_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_actuals_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "cost_actual_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_actuals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_buckets: {
        Row: {
          actual_to_date: number
          billing_method: string
          bucket: string
          contract_quantity: number
          cost_code: string
          created_at: string
          earned_percent_complete: number
          ftc: number
          id: string
          original_budget: number
          project_id: string
          retainage_pct: number
          sort_order: number
          source_date: string | null
          source_note: string
          source_type: string
          unit: string
          updated_at: string
        }
        Insert: {
          actual_to_date?: number
          billing_method?: string
          bucket: string
          contract_quantity?: number
          cost_code?: string
          created_at?: string
          earned_percent_complete?: number
          ftc?: number
          id?: string
          original_budget?: number
          project_id: string
          retainage_pct?: number
          sort_order?: number
          source_date?: string | null
          source_note?: string
          source_type?: string
          unit?: string
          updated_at?: string
        }
        Update: {
          actual_to_date?: number
          billing_method?: string
          bucket?: string
          contract_quantity?: number
          cost_code?: string
          created_at?: string
          earned_percent_complete?: number
          ftc?: number
          id?: string
          original_budget?: number
          project_id?: string
          retainage_pct?: number
          sort_order?: number
          source_date?: string | null
          source_note?: string
          source_type?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_buckets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_library_items: {
        Row: {
          base_region: string
          category: string
          created_at: string
          crew_size: number | null
          csi_code: string
          csi_division: string
          description: string
          external_id: string
          id: string
          keywords: Json
          labor_cost_cents: number
          material_cost_cents: number
          organization_id: string
          productivity_per_hour: number | null
          source: string
          synonyms: Json
          unit: string
          updated_at: string
        }
        Insert: {
          base_region?: string
          category?: string
          created_at?: string
          crew_size?: number | null
          csi_code?: string
          csi_division: string
          description: string
          external_id?: string
          id?: string
          keywords?: Json
          labor_cost_cents?: number
          material_cost_cents?: number
          organization_id: string
          productivity_per_hour?: number | null
          source?: string
          synonyms?: Json
          unit: string
          updated_at?: string
        }
        Update: {
          base_region?: string
          category?: string
          created_at?: string
          crew_size?: number | null
          csi_code?: string
          csi_division?: string
          description?: string
          external_id?: string
          id?: string
          keywords?: Json
          labor_cost_cents?: number
          material_cost_cents?: number
          organization_id?: string
          productivity_per_hour?: number | null
          source?: string
          synonyms?: Json
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_library_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reports: {
        Row: {
          attachment_name: string
          attachment_path: string
          attachment_type: string
          author: string
          client_visible: boolean
          created_at: string
          created_by: string
          crew_count: number
          delays: string
          id: string
          notes: string
          project_id: string
          report_date: string
          safety_notes: string
          updated_at: string
          weather: string
          work_performed: string
        }
        Insert: {
          attachment_name?: string
          attachment_path?: string
          attachment_type?: string
          author?: string
          client_visible?: boolean
          created_at?: string
          created_by?: string
          crew_count?: number
          delays?: string
          id?: string
          notes?: string
          project_id: string
          report_date?: string
          safety_notes?: string
          updated_at?: string
          weather?: string
          work_performed?: string
        }
        Update: {
          attachment_name?: string
          attachment_path?: string
          attachment_type?: string
          author?: string
          client_visible?: boolean
          created_at?: string
          created_by?: string
          crew_count?: number
          delays?: string
          id?: string
          notes?: string
          project_id?: string
          report_date?: string
          safety_notes?: string
          updated_at?: string
          weather?: string
          work_performed?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      decisions: {
        Row: {
          created_at: string
          decision: string
          due_date: string | null
          id: string
          impact: string
          linked_co_id: string | null
          linked_exposure_id: string | null
          notes: string
          owner: string
          owner_email: string
          owner_user_id: string | null
          project_id: string
          reminder_at: string | null
          reminder_channel: string
          reminder_enabled: boolean
          status: Database["public"]["Enums"]["decision_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          decision?: string
          due_date?: string | null
          id?: string
          impact?: string
          linked_co_id?: string | null
          linked_exposure_id?: string | null
          notes?: string
          owner?: string
          owner_email?: string
          owner_user_id?: string | null
          project_id: string
          reminder_at?: string | null
          reminder_channel?: string
          reminder_enabled?: boolean
          status?: Database["public"]["Enums"]["decision_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          decision?: string
          due_date?: string | null
          id?: string
          impact?: string
          linked_co_id?: string | null
          linked_exposure_id?: string | null
          notes?: string
          owner?: string
          owner_email?: string
          owner_user_id?: string | null
          project_id?: string
          reminder_at?: string | null
          reminder_channel?: string
          reminder_enabled?: boolean
          status?: Database["public"]["Enums"]["decision_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "decisions_linked_co_id_fkey"
            columns: ["linked_co_id"]
            isOneToOne: false
            referencedRelation: "change_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_linked_exposure_id_fkey"
            columns: ["linked_exposure_id"]
            isOneToOne: false
            referencedRelation: "exposures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      estimate_line_items: {
        Row: {
          cost_code: string
          created_at: string
          csi_division: string
          description: string
          estimate_id: string
          id: string
          labor_extended_cents: number | null
          labor_unit_cost_cents: number
          library_item_id: string | null
          material_extended_cents: number | null
          material_unit_cost_cents: number
          notes: string
          quantity: number
          scope_group: string
          sort_order: number
          total_extended_cents: number | null
          unit: string
          updated_at: string
        }
        Insert: {
          cost_code?: string
          created_at?: string
          csi_division?: string
          description: string
          estimate_id: string
          id?: string
          labor_extended_cents?: number | null
          labor_unit_cost_cents?: number
          library_item_id?: string | null
          material_extended_cents?: number | null
          material_unit_cost_cents?: number
          notes?: string
          quantity?: number
          scope_group?: string
          sort_order?: number
          total_extended_cents?: number | null
          unit: string
          updated_at?: string
        }
        Update: {
          cost_code?: string
          created_at?: string
          csi_division?: string
          description?: string
          estimate_id?: string
          id?: string
          labor_extended_cents?: number | null
          labor_unit_cost_cents?: number
          library_item_id?: string | null
          material_extended_cents?: number | null
          material_unit_cost_cents?: number
          notes?: string
          quantity?: number
          scope_group?: string
          sort_order?: number
          total_extended_cents?: number | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_line_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_line_items_library_item_id_fkey"
            columns: ["library_item_id"]
            isOneToOne: false
            referencedRelation: "cost_library_items"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_markup_defaults: {
        Row: {
          bond_pct: number
          contingency_pct: number
          custom_markups: Json
          default_region: string
          default_region_multiplier: number
          general_conditions_pct: number
          id: string
          organization_id: string
          overhead_pct: number
          profit_pct: number
          tax_pct: number
          updated_at: string
        }
        Insert: {
          bond_pct?: number
          contingency_pct?: number
          custom_markups?: Json
          default_region?: string
          default_region_multiplier?: number
          general_conditions_pct?: number
          id?: string
          organization_id: string
          overhead_pct?: number
          profit_pct?: number
          tax_pct?: number
          updated_at?: string
        }
        Update: {
          bond_pct?: number
          contingency_pct?: number
          custom_markups?: Json
          default_region?: string
          default_region_multiplier?: number
          general_conditions_pct?: number
          id?: string
          organization_id?: string
          overhead_pct?: number
          profit_pct?: number
          tax_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_markup_defaults_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_plan_sets: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          estimate_id: string
          file_mime_type: string
          file_path: string
          file_size_bytes: number
          id: string
          name: string
          organization_id: string
          page_count: number
          sample_key: string
          source_file_name: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string
          estimate_id: string
          file_mime_type?: string
          file_path?: string
          file_size_bytes?: number
          id?: string
          name: string
          organization_id: string
          page_count?: number
          sample_key?: string
          source_file_name?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          estimate_id?: string
          file_mime_type?: string
          file_path?: string
          file_size_bytes?: number
          id?: string
          name?: string
          organization_id?: string
          page_count?: number
          sample_key?: string
          source_file_name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_plan_sets_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_plan_sets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_plan_sheets: {
        Row: {
          created_at: string
          discipline: string
          estimate_id: string
          height_px: number
          id: string
          page_number: number
          plan_set_id: string
          scale_feet_per_pixel: number
          scale_label: string
          sheet_name: string
          sheet_number: string
          sort_order: number
          updated_at: string
          width_px: number
        }
        Insert: {
          created_at?: string
          discipline?: string
          estimate_id: string
          height_px?: number
          id?: string
          page_number?: number
          plan_set_id: string
          scale_feet_per_pixel?: number
          scale_label?: string
          sheet_name?: string
          sheet_number?: string
          sort_order?: number
          updated_at?: string
          width_px?: number
        }
        Update: {
          created_at?: string
          discipline?: string
          estimate_id?: string
          height_px?: number
          id?: string
          page_number?: number
          plan_set_id?: string
          scale_feet_per_pixel?: number
          scale_label?: string
          sheet_name?: string
          sheet_number?: string
          sort_order?: number
          updated_at?: string
          width_px?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_plan_sheets_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_plan_sheets_plan_set_id_fkey"
            columns: ["plan_set_id"]
            isOneToOne: false
            referencedRelation: "estimate_plan_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_takeoff_measurements: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          estimate_id: string
          estimate_line_item_id: string | null
          geometry: Json
          id: string
          label: string
          library_item_id: string | null
          notes: string
          plan_sheet_id: string
          quantity: number
          tool_type: string
          unit: string
          updated_at: string
          waste_pct: number
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          estimate_id: string
          estimate_line_item_id?: string | null
          geometry?: Json
          id?: string
          label: string
          library_item_id?: string | null
          notes?: string
          plan_sheet_id: string
          quantity?: number
          tool_type: string
          unit: string
          updated_at?: string
          waste_pct?: number
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          estimate_id?: string
          estimate_line_item_id?: string | null
          geometry?: Json
          id?: string
          label?: string
          library_item_id?: string | null
          notes?: string
          plan_sheet_id?: string
          quantity?: number
          tool_type?: string
          unit?: string
          updated_at?: string
          waste_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_takeoff_measurements_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_takeoff_measurements_estimate_line_item_id_fkey"
            columns: ["estimate_line_item_id"]
            isOneToOne: false
            referencedRelation: "estimate_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_takeoff_measurements_library_item_id_fkey"
            columns: ["library_item_id"]
            isOneToOne: false
            referencedRelation: "cost_library_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_takeoff_measurements_plan_sheet_id_fkey"
            columns: ["plan_sheet_id"]
            isOneToOne: false
            referencedRelation: "estimate_plan_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      estimates: {
        Row: {
          bond_pct: number
          contingency_pct: number
          created_at: string
          created_by: string | null
          custom_markups: Json
          description: string
          folder: string
          general_conditions_pct: number
          id: string
          name: string
          opportunity_id: string | null
          organization_id: string
          overhead_pct: number
          profit_pct: number
          project_id: string | null
          project_type: string
          region: string
          region_multiplier: number
          status: string
          subtotal_cents: number
          subtotal_labor_cents: number
          subtotal_material_cents: number
          tax_pct: number
          total_with_markups_cents: number
          updated_at: string
        }
        Insert: {
          bond_pct?: number
          contingency_pct?: number
          created_at?: string
          created_by?: string | null
          custom_markups?: Json
          description?: string
          folder?: string
          general_conditions_pct?: number
          id?: string
          name: string
          opportunity_id?: string | null
          organization_id: string
          overhead_pct?: number
          profit_pct?: number
          project_id?: string | null
          project_type?: string
          region?: string
          region_multiplier?: number
          status?: string
          subtotal_cents?: number
          subtotal_labor_cents?: number
          subtotal_material_cents?: number
          tax_pct?: number
          total_with_markups_cents?: number
          updated_at?: string
        }
        Update: {
          bond_pct?: number
          contingency_pct?: number
          created_at?: string
          created_by?: string | null
          custom_markups?: Json
          description?: string
          folder?: string
          general_conditions_pct?: number
          id?: string
          name?: string
          opportunity_id?: string | null
          organization_id?: string
          overhead_pct?: number
          profit_pct?: number
          project_id?: string | null
          project_type?: string
          region?: string
          region_multiplier?: number
          status?: string
          subtotal_cents?: number
          subtotal_labor_cents?: number
          subtotal_material_cents?: number
          tax_pct?: number
          total_with_markups_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      exposures: {
        Row: {
          category: Database["public"]["Enums"]["exposure_category"]
          created_at: string
          description: string
          dollar_exposure: number
          due_date: string | null
          hold_class: Database["public"]["Enums"]["hold_class"]
          id: string
          next_review_at: string | null
          notes: string
          opened_at: string
          owner: string
          probability: number
          project_id: string
          release_condition: string
          release_note: string
          release_updated_at: string | null
          released_amount: number
          resolved_at: string | null
          response_path: Database["public"]["Enums"]["response_path"]
          schedule_impact_weeks: number | null
          status: Database["public"]["Enums"]["exposure_status"]
          title: string
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["exposure_category"]
          created_at?: string
          description?: string
          dollar_exposure?: number
          due_date?: string | null
          hold_class?: Database["public"]["Enums"]["hold_class"]
          id?: string
          next_review_at?: string | null
          notes?: string
          opened_at?: string
          owner?: string
          probability?: number
          project_id: string
          release_condition?: string
          release_note?: string
          release_updated_at?: string | null
          released_amount?: number
          resolved_at?: string | null
          response_path?: Database["public"]["Enums"]["response_path"]
          schedule_impact_weeks?: number | null
          status?: Database["public"]["Enums"]["exposure_status"]
          title?: string
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["exposure_category"]
          created_at?: string
          description?: string
          dollar_exposure?: number
          due_date?: string | null
          hold_class?: Database["public"]["Enums"]["hold_class"]
          id?: string
          next_review_at?: string | null
          notes?: string
          opened_at?: string
          owner?: string
          probability?: number
          project_id?: string
          release_condition?: string
          release_note?: string
          release_updated_at?: string | null
          released_amount?: number
          resolved_at?: string | null
          response_path?: Database["public"]["Enums"]["response_path"]
          schedule_impact_weeks?: number | null
          status?: Database["public"]["Enums"]["exposure_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exposures_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["account_role"]
          status: Database["public"]["Enums"]["invite_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["account_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["account_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          invited_email: string
          organization_id: string
          role: Database["public"]["Enums"]["account_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          invited_email?: string
          organization_id: string
          role?: Database["public"]["Enums"]["account_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          invited_email?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["account_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          billing_status: string
          contractor_circle_grant: boolean
          created_at: string
          created_by: string | null
          daily_report_limit_per_month: number
          id: string
          name: string
          plan_code: string
          project_limit: number
          seat_limit: number
          slug: string
          storage_limit_mb: number
          stripe_customer_id: string
          stripe_subscription_id: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          billing_status?: string
          contractor_circle_grant?: boolean
          created_at?: string
          created_by?: string | null
          daily_report_limit_per_month?: number
          id?: string
          name: string
          plan_code?: string
          project_limit?: number
          seat_limit?: number
          slug?: string
          storage_limit_mb?: number
          stripe_customer_id?: string
          stripe_subscription_id?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_status?: string
          contractor_circle_grant?: boolean
          created_at?: string
          created_by?: string | null
          daily_report_limit_per_month?: number
          id?: string
          name?: string
          plan_code?: string
          project_limit?: number
          seat_limit?: number
          slug?: string
          storage_limit_mb?: number
          stripe_customer_id?: string
          stripe_subscription_id?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["code"]
          },
        ]
      }
      payment_ledger: {
        Row: {
          amount: number
          billing_application_id: string | null
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          net_payout: number
          notes: string
          overwatch_fee: number
          paid_at: string
          payment_method: string
          processor: string
          processor_fee: number
          processor_payment_id: string
          project_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number
          billing_application_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          net_payout?: number
          notes?: string
          overwatch_fee?: number
          paid_at?: string
          payment_method?: string
          processor?: string
          processor_fee?: number
          processor_payment_id?: string
          project_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          billing_application_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          net_payout?: number
          notes?: string
          overwatch_fee?: number
          paid_at?: string
          payment_method?: string
          processor?: string
          processor_fee?: number
          processor_payment_id?: string
          project_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_ledger_billing_application_id_fkey"
            columns: ["billing_application_id"]
            isOneToOne: false
            referencedRelation: "billing_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_ledger_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_ledger_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string
          company_title: string
          created_at: string
          default_organization_id: string | null
          email: string
          full_name: string
          id: string
          phone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string
          company_title?: string
          created_at?: string
          default_organization_id?: string | null
          email?: string
          full_name?: string
          id: string
          phone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string
          company_title?: string
          created_at?: string
          default_organization_id?: string | null
          email?: string
          full_name?: string
          id?: string
          phone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_organization_fkey"
            columns: ["default_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_client_access: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          can_view_billing: boolean
          can_view_change_orders: boolean
          can_view_daily_reports: boolean
          client_user_id: string | null
          contact_id: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          last_sent_at: string | null
          project_id: string
          role: string
          status: Database["public"]["Enums"]["client_access_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          can_view_billing?: boolean
          can_view_change_orders?: boolean
          can_view_daily_reports?: boolean
          client_user_id?: string | null
          contact_id?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          last_sent_at?: string | null
          project_id: string
          role?: string
          status?: Database["public"]["Enums"]["client_access_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          can_view_billing?: boolean
          can_view_change_orders?: boolean
          can_view_daily_reports?: boolean
          client_user_id?: string | null
          contact_id?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          last_sent_at?: string | null
          project_id?: string
          role?: string
          status?: Database["public"]["Enums"]["client_access_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_client_access_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_client_access_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_memberships: {
        Row: {
          created_at: string
          id: string
          project_id: string
          role: Database["public"]["Enums"]["project_member_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          role?: Database["public"]["Enums"]["project_member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["project_member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_memberships_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          baseline_completion_date: string | null
          billing_contact_email: string
          billing_contact_name: string
          billing_frequency: string
          client: string
          created_at: string
          default_retainage_pct: number
          forecast_completion_date: string | null
          hold_variance_note: string
          id: string
          job_number: string
          last_review_summary: string
          last_reviewed_at: string | null
          name: string
          next_billing_date: string | null
          next_review_at: string | null
          organization_id: string | null
          original_contract: number
          original_cost_budget: number
          owner_id: string
          percent_complete: number
          phase: Database["public"]["Enums"]["project_phase"]
          project_manager: string
          schedule_variance_weeks: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          baseline_completion_date?: string | null
          billing_contact_email?: string
          billing_contact_name?: string
          billing_frequency?: string
          client?: string
          created_at?: string
          default_retainage_pct?: number
          forecast_completion_date?: string | null
          hold_variance_note?: string
          id?: string
          job_number?: string
          last_review_summary?: string
          last_reviewed_at?: string | null
          name: string
          next_billing_date?: string | null
          next_review_at?: string | null
          organization_id?: string | null
          original_contract?: number
          original_cost_budget?: number
          owner_id: string
          percent_complete?: number
          phase?: Database["public"]["Enums"]["project_phase"]
          project_manager?: string
          schedule_variance_weeks?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          baseline_completion_date?: string | null
          billing_contact_email?: string
          billing_contact_name?: string
          billing_frequency?: string
          client?: string
          created_at?: string
          default_retainage_pct?: number
          forecast_completion_date?: string | null
          hold_variance_note?: string
          id?: string
          job_number?: string
          last_review_summary?: string
          last_reviewed_at?: string | null
          name?: string
          next_billing_date?: string | null
          next_review_at?: string | null
          organization_id?: string | null
          original_contract?: number
          original_cost_budget?: number
          owner_id?: string
          percent_complete?: number
          phase?: Database["public"]["Enums"]["project_phase"]
          project_manager?: string
          schedule_variance_weeks?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          body_markdown: string
          created_at: string
          email_recipients: string[]
          forecast_completion_date_after: string | null
          forecast_completion_date_before: string | null
          id: string
          kpi_snapshot: Json
          pdf_style: string
          project_id: string
          reviewed_at: string
          reviewer: string
          rollup_snapshot: Json
          status: string
          summary_notes: string
        }
        Insert: {
          body_markdown?: string
          created_at?: string
          email_recipients?: string[]
          forecast_completion_date_after?: string | null
          forecast_completion_date_before?: string | null
          id?: string
          kpi_snapshot?: Json
          pdf_style?: string
          project_id: string
          reviewed_at?: string
          reviewer?: string
          rollup_snapshot?: Json
          status?: string
          summary_notes?: string
        }
        Update: {
          body_markdown?: string
          created_at?: string
          email_recipients?: string[]
          forecast_completion_date_after?: string | null
          forecast_completion_date_before?: string | null
          id?: string
          kpi_snapshot?: Json
          pdf_style?: string
          project_id?: string
          reviewed_at?: string
          reviewer?: string
          rollup_snapshot?: Json
          status?: string
          summary_notes?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_activities: {
        Row: {
          activity_id: string
          created_at: string
          division: string
          finish_date: string | null
          id: string
          name: string
          notes: string
          percent_complete: number
          predecessor_activity_ids: string[]
          project_id: string
          sort_order: number
          start_date: string | null
          successor_activity_ids: string[]
          updated_at: string
          wbs_section_id: string | null
        }
        Insert: {
          activity_id?: string
          created_at?: string
          division?: string
          finish_date?: string | null
          id?: string
          name: string
          notes?: string
          percent_complete?: number
          predecessor_activity_ids?: string[]
          project_id: string
          sort_order?: number
          start_date?: string | null
          successor_activity_ids?: string[]
          updated_at?: string
          wbs_section_id?: string | null
        }
        Update: {
          activity_id?: string
          created_at?: string
          division?: string
          finish_date?: string | null
          id?: string
          name?: string
          notes?: string
          percent_complete?: number
          predecessor_activity_ids?: string[]
          project_id?: string
          sort_order?: number
          start_date?: string | null
          successor_activity_ids?: string[]
          updated_at?: string
          wbs_section_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_activities_wbs_section_id_fkey"
            columns: ["wbs_section_id"]
            isOneToOne: false
            referencedRelation: "schedule_wbs_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_delay_fragments: {
        Row: {
          activity_id: string
          created_at: string
          delay_days: number
          id: string
          identified_on: string
          owner: string
          project_id: string
          reason: string
          resolved_on: string | null
          schedule_activity_id: string | null
          source: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          activity_id?: string
          created_at?: string
          delay_days?: number
          id?: string
          identified_on?: string
          owner?: string
          project_id: string
          reason?: string
          resolved_on?: string | null
          schedule_activity_id?: string | null
          source?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          activity_id?: string
          created_at?: string
          delay_days?: number
          id?: string
          identified_on?: string
          owner?: string
          project_id?: string
          reason?: string
          resolved_on?: string | null
          schedule_activity_id?: string | null
          source?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_delay_fragments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_delay_fragments_schedule_activity_id_fkey"
            columns: ["schedule_activity_id"]
            isOneToOne: false
            referencedRelation: "schedule_activities"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_milestone_updates: {
        Row: {
          baseline_date: string | null
          created_at: string
          forecast_date: string | null
          id: string
          milestone_id: string
          notes: string
          project_id: string
          schedule_update_id: string | null
          status: string
          update_number: number
          updated_at: string
          variance_weeks: number
        }
        Insert: {
          baseline_date?: string | null
          created_at?: string
          forecast_date?: string | null
          id?: string
          milestone_id: string
          notes?: string
          project_id: string
          schedule_update_id?: string | null
          status?: string
          update_number: number
          updated_at?: string
          variance_weeks?: number
        }
        Update: {
          baseline_date?: string | null
          created_at?: string
          forecast_date?: string | null
          id?: string
          milestone_id?: string
          notes?: string
          project_id?: string
          schedule_update_id?: string | null
          status?: string
          update_number?: number
          updated_at?: string
          variance_weeks?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedule_milestone_updates_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "schedule_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_milestone_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_milestone_updates_schedule_update_id_fkey"
            columns: ["schedule_update_id"]
            isOneToOne: false
            referencedRelation: "schedule_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_milestones: {
        Row: {
          baseline_date: string | null
          created_at: string
          delay_reason: string
          forecast_date: string | null
          id: string
          name: string
          owner: string
          project_id: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          baseline_date?: string | null
          created_at?: string
          delay_reason?: string
          forecast_date?: string | null
          id?: string
          name: string
          owner?: string
          project_id: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          baseline_date?: string | null
          created_at?: string
          delay_reason?: string
          forecast_date?: string | null
          id?: string
          name?: string
          owner?: string
          project_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_risks: {
        Row: {
          completed_at: string | null
          created_at: string
          detail: string
          dollar_exposure: number
          due_date: string | null
          hold_class: Database["public"]["Enums"]["hold_class"]
          id: string
          inactive_reason: string
          kind: string
          linked_exposure_id: string | null
          owner: string
          probability: number
          project_id: string
          response_path: Database["public"]["Enums"]["response_path"]
          schedule_impact_weeks: number | null
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          detail?: string
          dollar_exposure?: number
          due_date?: string | null
          hold_class?: Database["public"]["Enums"]["hold_class"]
          id?: string
          inactive_reason?: string
          kind: string
          linked_exposure_id?: string | null
          owner?: string
          probability?: number
          project_id: string
          response_path?: Database["public"]["Enums"]["response_path"]
          schedule_impact_weeks?: number | null
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          detail?: string
          dollar_exposure?: number
          due_date?: string | null
          hold_class?: Database["public"]["Enums"]["hold_class"]
          id?: string
          inactive_reason?: string
          kind?: string
          linked_exposure_id?: string | null
          owner?: string
          probability?: number
          project_id?: string
          response_path?: Database["public"]["Enums"]["response_path"]
          schedule_impact_weeks?: number | null
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_risks_linked_exposure_id_fkey"
            columns: ["linked_exposure_id"]
            isOneToOne: false
            referencedRelation: "exposures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_risks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_updates: {
        Row: {
          baseline_completion_date: string | null
          created_at: string
          created_by: string | null
          data_date: string | null
          forecast_completion_date: string
          id: string
          money_notes: string
          movement_weeks: number
          notes: string
          project_id: string
          schedule_money_exposure: number
          schedule_money_net: number
          schedule_money_recovery: number
          update_date: string
          update_number: number
          updated_at: string
          variance_weeks: number
        }
        Insert: {
          baseline_completion_date?: string | null
          created_at?: string
          created_by?: string | null
          data_date?: string | null
          forecast_completion_date: string
          id?: string
          money_notes?: string
          movement_weeks?: number
          notes?: string
          project_id: string
          schedule_money_exposure?: number
          schedule_money_net?: number
          schedule_money_recovery?: number
          update_date?: string
          update_number: number
          updated_at?: string
          variance_weeks?: number
        }
        Update: {
          baseline_completion_date?: string | null
          created_at?: string
          created_by?: string | null
          data_date?: string | null
          forecast_completion_date?: string
          id?: string
          money_notes?: string
          movement_weeks?: number
          notes?: string
          project_id?: string
          schedule_money_exposure?: number
          schedule_money_net?: number
          schedule_money_recovery?: number
          update_date?: string
          update_number?: number
          updated_at?: string
          variance_weeks?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedule_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_wbs_sections: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          parent_id: string | null
          project_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code?: string
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          project_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          project_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_wbs_sections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_wbs_sections_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "schedule_wbs_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          code: string
          created_at: string
          daily_report_limit_per_month: number | null
          is_public: boolean
          monthly_price_cents: number
          name: string
          project_limit: number | null
          seat_limit: number | null
          storage_limit_mb: number | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          daily_report_limit_per_month?: number | null
          is_public?: boolean
          monthly_price_cents?: number
          name: string
          project_limit?: number | null
          seat_limit?: number | null
          storage_limit_mb?: number | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          daily_report_limit_per_month?: number | null
          is_public?: boolean
          monthly_price_cents?: number
          name?: string
          project_limit?: number | null
          seat_limit?: number | null
          storage_limit_mb?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_approve_client_change_order: {
        Args: { p_change_order_id: string }
        Returns: boolean
      }
      can_create_project_in_org: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      can_manage_org: { Args: { p_org_id: string }; Returns: boolean }
      can_manage_project: { Args: { p_project_id: string }; Returns: boolean }
      can_read_client_project: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      can_read_project: { Args: { p_project_id: string }; Returns: boolean }
      can_view_client_billing: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      cost_actual_rollup_amount: {
        Args: { p_amount: number; p_status: string }
        Returns: number
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_current_user_account: { Args: never; Returns: string }
      ensure_user_account: {
        Args: { p_email: string; p_full_name?: string; p_user_id: string }
        Returns: string
      }
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      record_client_change_order_decision: {
        Args: {
          p_change_order_id: string
          p_decision: Database["public"]["Enums"]["client_approval_decision"]
          p_notes?: string
          p_user_agent?: string
        }
        Returns: string
      }
      reorder_schedule_wbs_sections: {
        Args: {
          p_ordered_ids: string[]
          p_parent_id?: string | null
          p_project_id: string
        }
        Returns: number
      }
      storage_estimate_id: { Args: { p_name: string }; Returns: string }
      storage_project_id: { Args: { p_name: string }; Returns: string }
      sync_billing_application_from_lines: {
        Args: { p_billing_application_id: string }
        Returns: undefined
      }
    }
    Enums: {
      account_role:
        | "owner"
        | "admin"
        | "executive"
        | "project_manager"
        | "member"
        | "viewer"
      client_access_status: "pending" | "active" | "revoked"
      client_approval_decision: "approved" | "rejected" | "comment"
      client_change_order_status: "not_sent" | "sent" | "approved" | "rejected"
      decision_status: "open" | "in_progress" | "resolved" | "overdue"
      exposure_category:
        | "owner_decision"
        | "design_drift"
        | "trade_performance"
        | "procurement"
        | "schedule_compression"
        | "allowance_overrun"
        | "field_change"
        | "closeout_punch"
        | "other"
      exposure_status:
        | "active"
        | "escalated"
        | "recovered"
        | "eliminated"
        | "accepted"
        | "released"
      hold_class: "E-Hold" | "C-Hold" | "Both" | "None"
      invite_status: "pending" | "accepted" | "revoked" | "expired"
      member_status: "pending" | "active" | "disabled"
      project_member_role: "owner" | "manager" | "editor" | "viewer"
      project_phase: "Early" | "Middle" | "Late"
      response_path: "eliminate" | "recover" | "offset" | "accept"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      account_role: [
        "owner",
        "admin",
        "executive",
        "project_manager",
        "member",
        "viewer",
      ],
      client_access_status: ["pending", "active", "revoked"],
      client_approval_decision: ["approved", "rejected", "comment"],
      client_change_order_status: ["not_sent", "sent", "approved", "rejected"],
      decision_status: ["open", "in_progress", "resolved", "overdue"],
      exposure_category: [
        "owner_decision",
        "design_drift",
        "trade_performance",
        "procurement",
        "schedule_compression",
        "allowance_overrun",
        "field_change",
        "closeout_punch",
        "other",
      ],
      exposure_status: [
        "active",
        "escalated",
        "recovered",
        "eliminated",
        "accepted",
        "released",
      ],
      hold_class: ["E-Hold", "C-Hold", "Both", "None"],
      invite_status: ["pending", "accepted", "revoked", "expired"],
      member_status: ["pending", "active", "disabled"],
      project_member_role: ["owner", "manager", "editor", "viewer"],
      project_phase: ["Early", "Middle", "Late"],
      response_path: ["eliminate", "recover", "offset", "accept"],
    },
  },
} as const
