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
      ai_operations: {
        Row: {
          api_cost_cents: number
          created_at: string
          created_by: string | null
          credits_charged: number
          error: string
          estimate_id: string | null
          exemplar_description: string | null
          id: string
          input_tokens: number
          model_used: string
          operation_type: string
          organization_id: string
          output_tokens: number
          request_context: Json
          result: Json
          sheet_ids: string[]
          sheets_completed: number
          status: string
          updated_at: string
        }
        Insert: {
          api_cost_cents?: number
          created_at?: string
          created_by?: string | null
          credits_charged?: number
          error?: string
          estimate_id?: string | null
          exemplar_description?: string | null
          id?: string
          input_tokens?: number
          model_used?: string
          operation_type?: string
          organization_id: string
          output_tokens?: number
          request_context?: Json
          result?: Json
          sheet_ids?: string[]
          sheets_completed?: number
          status?: string
          updated_at?: string
        }
        Update: {
          api_cost_cents?: number
          created_at?: string
          created_by?: string | null
          credits_charged?: number
          error?: string
          estimate_id?: string | null
          exemplar_description?: string | null
          id?: string
          input_tokens?: number
          model_used?: string
          operation_type?: string
          organization_id?: string
          output_tokens?: number
          request_context?: Json
          result?: Json
          sheet_ids?: string[]
          sheets_completed?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_operations_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_operations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_symbol_library_examples: {
        Row: {
          accepted_count: number
          created_at: string
          created_by: string | null
          embedding: Json
          exemplar_storage_path: string
          id: string
          library_item_id: string
          organization_id: string
          rejected_count: number
          source_ai_operation_id: string | null
          source_estimate_id: string | null
          source_plan_sheet_id: string | null
          source_point: Json
          source_point_key: string
        }
        Insert: {
          accepted_count: number
          created_at?: string
          created_by?: string | null
          embedding: Json
          exemplar_storage_path: string
          id?: string
          library_item_id: string
          organization_id: string
          rejected_count?: number
          source_ai_operation_id?: string | null
          source_estimate_id?: string | null
          source_plan_sheet_id?: string | null
          source_point: Json
          source_point_key: string
        }
        Update: {
          accepted_count?: number
          created_at?: string
          created_by?: string | null
          embedding?: Json
          exemplar_storage_path?: string
          id?: string
          library_item_id?: string
          organization_id?: string
          rejected_count?: number
          source_ai_operation_id?: string | null
          source_estimate_id?: string | null
          source_plan_sheet_id?: string | null
          source_point?: Json
          source_point_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_symbol_library_examples_library_item_id_fkey"
            columns: ["library_item_id"]
            isOneToOne: false
            referencedRelation: "ai_symbol_library_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_symbol_library_examples_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_symbol_library_examples_source_ai_operation_id_fkey"
            columns: ["source_ai_operation_id"]
            isOneToOne: false
            referencedRelation: "ai_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_symbol_library_examples_source_estimate_id_fkey"
            columns: ["source_estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_symbol_library_examples_source_plan_sheet_id_fkey"
            columns: ["source_plan_sheet_id"]
            isOneToOne: false
            referencedRelation: "estimate_plan_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_symbol_library_items: {
        Row: {
          active: boolean
          cost_library_item_id: string | null
          created_at: string
          created_by: string | null
          id: string
          label: string
          last_used_at: string | null
          normalized_label: string
          organization_id: string
          trade: string
          unit: string
          updated_at: string
          use_count: number
        }
        Insert: {
          active?: boolean
          cost_library_item_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          last_used_at?: string | null
          normalized_label: string
          organization_id: string
          trade?: string
          unit?: string
          updated_at?: string
          use_count?: number
        }
        Update: {
          active?: boolean
          cost_library_item_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          last_used_at?: string | null
          normalized_label?: string
          organization_id?: string
          trade?: string
          unit?: string
          updated_at?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_symbol_library_items_cost_library_item_id_fkey"
            columns: ["cost_library_item_id"]
            isOneToOne: false
            referencedRelation: "cost_library_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_symbol_library_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
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
      beta_feedback: {
        Row: {
          context: Json
          created_at: string
          created_by: string
          id: string
          message: string
          organization_id: string
          route: string
        }
        Insert: {
          context?: Json
          created_at?: string
          created_by: string
          id?: string
          message?: string
          organization_id: string
          route?: string
        }
        Update: {
          context?: Json
          created_at?: string
          created_by?: string
          id?: string
          message?: string
          organization_id?: string
          route?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_feedback_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_application_commands: {
        Row: {
          actor_id: string
          billing_application_id: string
          command_type: string
          created_at: string
          id: string
          idempotency_fingerprint: string
          idempotency_key: string
          project_id: string
          result: Json
        }
        Insert: {
          actor_id: string
          billing_application_id: string
          command_type: string
          created_at?: string
          id?: string
          idempotency_fingerprint: string
          idempotency_key: string
          project_id: string
          result?: Json
        }
        Update: {
          actor_id?: string
          billing_application_id?: string
          command_type?: string
          created_at?: string
          id?: string
          idempotency_fingerprint?: string
          idempotency_key?: string
          project_id?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "billing_application_commands_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_application_events: {
        Row: {
          amount: number
          billing_application_id: string
          created_at: string
          created_by: string | null
          event_type: string
          from_status: string
          id: string
          notes: string
          project_id: string
          to_status: string
        }
        Insert: {
          amount?: number
          billing_application_id: string
          created_at?: string
          created_by?: string | null
          event_type?: string
          from_status?: string
          id?: string
          notes?: string
          project_id: string
          to_status?: string
        }
        Update: {
          amount?: number
          billing_application_id?: string
          created_at?: string
          created_by?: string | null
          event_type?: string
          from_status?: string
          id?: string
          notes?: string
          project_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_application_events_billing_application_id_fkey"
            columns: ["billing_application_id"]
            isOneToOne: false
            referencedRelation: "billing_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_application_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_applications: {
        Row: {
          amount_billed: number
          application_number: string
          billing_period: string
          billing_snapshot_bucket_count: number
          change_order_amount: number
          contract_amount: number
          created_at: string
          due_date: string | null
          has_line_detail: boolean
          id: string
          invoice_number: string
          notes: string
          output_format: string
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
          billing_snapshot_bucket_count?: number
          change_order_amount?: number
          contract_amount?: number
          created_at?: string
          due_date?: string | null
          has_line_detail?: boolean
          id?: string
          invoice_number?: string
          notes?: string
          output_format?: string
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
          billing_snapshot_bucket_count?: number
          change_order_amount?: number
          contract_amount?: number
          created_at?: string
          due_date?: string | null
          has_line_detail?: boolean
          id?: string
          invoice_number?: string
          notes?: string
          output_format?: string
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
      billing_invoice_commands: {
        Row: {
          actor_id: string
          billing_invoice_id: string
          command_type: string
          created_at: string
          id: string
          idempotency_fingerprint: string
          idempotency_key: string
          project_id: string
          result: Json
        }
        Insert: {
          actor_id: string
          billing_invoice_id: string
          command_type: string
          created_at?: string
          id?: string
          idempotency_fingerprint: string
          idempotency_key: string
          project_id: string
          result?: Json
        }
        Update: {
          actor_id?: string
          billing_invoice_id?: string
          command_type?: string
          created_at?: string
          id?: string
          idempotency_fingerprint?: string
          idempotency_key?: string
          project_id?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoice_commands_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_invoice_legacy_repairs: {
        Row: {
          after_state: Json
          before_state: Json
          billing_application_id: string | null
          billing_invoice_id: string
          created_at: string
          id: string
          project_id: string
          reason: string
          repair_type: string
        }
        Insert: {
          after_state: Json
          before_state: Json
          billing_application_id?: string | null
          billing_invoice_id: string
          created_at?: string
          id?: string
          project_id: string
          reason: string
          repair_type: string
        }
        Update: {
          after_state?: Json
          before_state?: Json
          billing_application_id?: string | null
          billing_invoice_id?: string
          created_at?: string
          id?: string
          project_id?: string
          reason?: string
          repair_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoice_legacy_repairs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_invoice_portal_view_commands: {
        Row: {
          billing_invoice_id: string
          created_at: string
          event_key: string
          id: string
          project_id: string
          request_fingerprint: string
          result: Json
          user_agent: string
          viewed_at: string
          viewer_email: string
          viewer_user_id: string
        }
        Insert: {
          billing_invoice_id: string
          created_at?: string
          event_key: string
          id?: string
          project_id: string
          request_fingerprint: string
          result: Json
          user_agent?: string
          viewed_at: string
          viewer_email?: string
          viewer_user_id: string
        }
        Update: {
          billing_invoice_id?: string
          created_at?: string
          event_key?: string
          id?: string
          project_id?: string
          request_fingerprint?: string
          result?: Json
          user_agent?: string
          viewed_at?: string
          viewer_email?: string
          viewer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoice_portal_view_commands_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_invoice_processor_commands: {
        Row: {
          billing_invoice_id: string
          created_at: string
          id: string
          idempotency_key: string
          project_id: string
          request_fingerprint: string
          result: Json
        }
        Insert: {
          billing_invoice_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          project_id: string
          request_fingerprint: string
          result: Json
        }
        Update: {
          billing_invoice_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          project_id?: string
          request_fingerprint?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoice_processor_commands_project_id_fkey"
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
          collections_log: string
          correction_of_invoice_id: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          enabled_payment_methods: Json
          first_viewed_at: string | null
          id: string
          invoice_number: string
          issue_date: string | null
          last_viewed_at: string | null
          notes: string
          online_payment_status: string
          paid_amount: number
          paid_at: string | null
          payment_enabled: boolean
          payment_link_sent_at: string | null
          payment_url: string
          project_id: string
          retainage: number
          sent_at: string | null
          sent_recipients: Json
          status: string
          stripe_checkout_session_id: string
          stripe_payment_intent_id: string
          subtotal: number
          title: string
          total_due: number
          updated_at: string
          view_count: number
        }
        Insert: {
          billing_application_id?: string | null
          client_visible?: boolean
          collections_log?: string
          correction_of_invoice_id?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          enabled_payment_methods?: Json
          first_viewed_at?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string | null
          last_viewed_at?: string | null
          notes?: string
          online_payment_status?: string
          paid_amount?: number
          paid_at?: string | null
          payment_enabled?: boolean
          payment_link_sent_at?: string | null
          payment_url?: string
          project_id: string
          retainage?: number
          sent_at?: string | null
          sent_recipients?: Json
          status?: string
          stripe_checkout_session_id?: string
          stripe_payment_intent_id?: string
          subtotal?: number
          title?: string
          total_due?: number
          updated_at?: string
          view_count?: number
        }
        Update: {
          billing_application_id?: string | null
          client_visible?: boolean
          collections_log?: string
          correction_of_invoice_id?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          enabled_payment_methods?: Json
          first_viewed_at?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string | null
          last_viewed_at?: string | null
          notes?: string
          online_payment_status?: string
          paid_amount?: number
          paid_at?: string | null
          payment_enabled?: boolean
          payment_link_sent_at?: string | null
          payment_url?: string
          project_id?: string
          retainage?: number
          sent_at?: string | null
          sent_recipients?: Json
          status?: string
          stripe_checkout_session_id?: string
          stripe_payment_intent_id?: string
          subtotal?: number
          title?: string
          total_due?: number
          updated_at?: string
          view_count?: number
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
            foreignKeyName: "billing_invoices_correction_of_invoice_id_fkey"
            columns: ["correction_of_invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
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
      billing_line_change_order_allocations: {
        Row: {
          billing_application_id: string
          billing_line_item_id: string
          captured_at: string
          change_order_allocation_id: string
          contract_amount_cents: number
          cost_amount_cents: number
          cost_bucket_id: string | null
          project_id: string
        }
        Insert: {
          billing_application_id: string
          billing_line_item_id: string
          captured_at?: string
          change_order_allocation_id: string
          contract_amount_cents: number
          cost_amount_cents: number
          cost_bucket_id?: string | null
          project_id: string
        }
        Update: {
          billing_application_id?: string
          billing_line_item_id?: string
          captured_at?: string
          change_order_allocation_id?: string
          contract_amount_cents?: number
          cost_amount_cents?: number
          cost_bucket_id?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_line_change_order_alloc_change_order_allocation_id_fkey"
            columns: ["change_order_allocation_id"]
            isOneToOne: false
            referencedRelation: "change_order_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_line_change_order_allocatio_billing_application_id_fkey"
            columns: ["billing_application_id"]
            isOneToOne: false
            referencedRelation: "billing_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_line_change_order_allocations_billing_line_item_id_fkey"
            columns: ["billing_line_item_id"]
            isOneToOne: false
            referencedRelation: "billing_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_line_change_order_allocations_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_line_change_order_allocations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_line_co_provenance_findings: {
        Row: {
          billing_application_id: string
          billing_line_item_id: string
          candidate_allocation_ids: string[]
          candidate_contract_amount_cents: number
          candidate_count: number
          captured_change_order_value_cents: number
          cost_bucket_id: string | null
          detected_at: string
          finding_reason: string
          finding_status: string
          project_id: string
        }
        Insert: {
          billing_application_id: string
          billing_line_item_id: string
          candidate_allocation_ids?: string[]
          candidate_contract_amount_cents?: number
          candidate_count?: number
          captured_change_order_value_cents: number
          cost_bucket_id?: string | null
          detected_at?: string
          finding_reason: string
          finding_status?: string
          project_id: string
        }
        Update: {
          billing_application_id?: string
          billing_line_item_id?: string
          candidate_allocation_ids?: string[]
          candidate_contract_amount_cents?: number
          candidate_count?: number
          captured_change_order_value_cents?: number
          cost_bucket_id?: string | null
          detected_at?: string
          finding_reason?: string
          finding_status?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_line_co_provenance_findings_billing_application_id_fkey"
            columns: ["billing_application_id"]
            isOneToOne: false
            referencedRelation: "billing_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_line_co_provenance_findings_billing_line_item_id_fkey"
            columns: ["billing_line_item_id"]
            isOneToOne: true
            referencedRelation: "billing_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_line_co_provenance_findings_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_line_co_provenance_findings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_line_item_commands: {
        Row: {
          changed_by: string
          created_at: string
          id: string
          operation_key: string
          project_id: string
          request_fingerprint: string
          result: Json
        }
        Insert: {
          changed_by: string
          created_at?: string
          id?: string
          operation_key: string
          project_id: string
          request_fingerprint: string
          result?: Json
        }
        Update: {
          changed_by?: string
          created_at?: string
          id?: string
          operation_key?: string
          project_id?: string
          request_fingerprint?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "billing_line_item_commands_project_id_fkey"
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
      budget_command_operations: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          operation_key: string
          operation_type: string
          project_id: string
          request_fingerprint: string
          result: Json
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          operation_key: string
          operation_type: string
          project_id: string
          request_fingerprint: string
          result?: Json
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          operation_key?: string
          operation_type?: string
          project_id?: string
          request_fingerprint?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "budget_command_operations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_line_overrides: {
        Row: {
          changed_by: string | null
          cost_bucket_id: string | null
          created_at: string
          field: string
          id: string
          new_value: number
          note: string | null
          old_value: number
          operation_key: string | null
          project_id: string
          request_fingerprint: string | null
        }
        Insert: {
          changed_by?: string | null
          cost_bucket_id?: string | null
          created_at?: string
          field: string
          id?: string
          new_value?: number
          note?: string | null
          old_value?: number
          operation_key?: string | null
          project_id: string
          request_fingerprint?: string | null
        }
        Update: {
          changed_by?: string | null
          cost_bucket_id?: string | null
          created_at?: string
          field?: string
          id?: string
          new_value?: number
          note?: string | null
          old_value?: number
          operation_key?: string | null
          project_id?: string
          request_fingerprint?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_line_overrides_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_line_overrides_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_money_repairs: {
        Row: {
          cost_bucket_id: string | null
          created_at: string
          field: string
          id: string
          migration_key: string
          new_value: number
          old_value: number
          project_id: string
          target_key: string
        }
        Insert: {
          cost_bucket_id?: string | null
          created_at?: string
          field: string
          id?: string
          migration_key: string
          new_value: number
          old_value: number
          project_id: string
          target_key: string
        }
        Update: {
          cost_bucket_id?: string | null
          created_at?: string
          field?: string
          id?: string
          migration_key?: string
          new_value?: number
          old_value?: number
          project_id?: string
          target_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_money_repairs_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_money_repairs_project_id_fkey"
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
          idempotency_fingerprint: string | null
          idempotency_key: string | null
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
          idempotency_fingerprint?: string | null
          idempotency_key?: string | null
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
          idempotency_fingerprint?: string | null
          idempotency_key?: string | null
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
      change_order_documents: {
        Row: {
          change_order_id: string
          created_at: string
          created_by: string | null
          doc_type: string
          file_name: string
          id: string
          note: string
          project_id: string
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          change_order_id: string
          created_at?: string
          created_by?: string | null
          doc_type?: string
          file_name?: string
          id?: string
          note?: string
          project_id: string
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          change_order_id?: string
          created_at?: string
          created_by?: string | null
          doc_type?: string
          file_name?: string
          id?: string
          note?: string
          project_id?: string
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_order_documents_change_order_id_fkey"
            columns: ["change_order_id"]
            isOneToOne: false
            referencedRelation: "change_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_order_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      change_order_operations: {
        Row: {
          change_order_id: string | null
          created_at: string
          created_by: string | null
          id: string
          operation_key: string
          operation_type: string
          project_id: string
          request_fingerprint: Json
          result: Json
        }
        Insert: {
          change_order_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          operation_key: string
          operation_type: string
          project_id: string
          request_fingerprint: Json
          result?: Json
        }
        Update: {
          change_order_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          operation_key?: string
          operation_type?: string
          project_id?: string
          request_fingerprint?: Json
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "change_order_operations_project_id_fkey"
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
          date_initiated: string | null
          description: string
          financial_direction: string
          id: string
          linked_claim_id: string | null
          linked_exposure_id: string | null
          notes: string
          number: string
          owner: string
          pricing_method: string
          probability: number
          project_id: string
          requested_by: string
          schedule_impact_days: number
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
          date_initiated?: string | null
          description?: string
          financial_direction?: string
          id?: string
          linked_claim_id?: string | null
          linked_exposure_id?: string | null
          notes?: string
          number?: string
          owner?: string
          pricing_method?: string
          probability?: number
          project_id: string
          requested_by?: string
          schedule_impact_days?: number
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
          date_initiated?: string | null
          description?: string
          financial_direction?: string
          id?: string
          linked_claim_id?: string | null
          linked_exposure_id?: string | null
          notes?: string
          number?: string
          owner?: string
          pricing_method?: string
          probability?: number
          project_id?: string
          requested_by?: string
          schedule_impact_days?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_orders_linked_claim_id_fkey"
            columns: ["linked_claim_id"]
            isOneToOne: false
            referencedRelation: "project_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_orders_linked_exposure_id_fkey"
            columns: ["linked_exposure_id"]
            isOneToOne: false
            referencedRelation: "exposures"
            referencedColumns: ["id"]
          },
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
      cost_actual_payments: {
        Row: {
          amount_cents: number
          cost_actual_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string
          operation_key: string
          payment_date: string
          payment_method: string
          payment_reference: string
          project_id: string
        }
        Insert: {
          amount_cents: number
          cost_actual_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string
          operation_key: string
          payment_date?: string
          payment_method?: string
          payment_reference?: string
          project_id: string
        }
        Update: {
          amount_cents?: number
          cost_actual_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string
          operation_key?: string
          payment_date?: string
          payment_method?: string
          payment_reference?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_actual_payments_cost_actual_id_fkey"
            columns: ["cost_actual_id"]
            isOneToOne: false
            referencedRelation: "cost_actuals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_actual_payments_project_id_fkey"
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
          amount_cents: number
          approved_at: string | null
          approved_by: string | null
          budget_open_relief: number
          category: string
          cost_bucket_id: string | null
          cost_code: string
          cost_date: string
          cost_document_id: string
          created_at: string
          created_by: string | null
          credit_applies_to_id: string | null
          daily_wip_offset: number
          daily_wip_offset_cents: number
          description: string
          exposure_id: string | null
          id: string
          import_batch_id: string | null
          invoice_attachment_name: string
          invoice_attachment_path: string
          invoice_attachment_size: number
          invoice_attachment_type: string
          notes: string
          paid_at: string | null
          paid_date: string | null
          payment_method: string
          payment_reference: string
          project_id: string
          reference_number: string
          source_external_id: string
          source_row_hash: string
          status: string
          subcontract_change_order_id: string | null
          subcontract_payment_id: string | null
          updated_at: string
          vendor: string
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount?: number
          amount_cents?: number
          approved_at?: string | null
          approved_by?: string | null
          budget_open_relief?: number
          category?: string
          cost_bucket_id?: string | null
          cost_code?: string
          cost_date: string
          cost_document_id?: string
          created_at?: string
          created_by?: string | null
          credit_applies_to_id?: string | null
          daily_wip_offset?: number
          daily_wip_offset_cents?: number
          description: string
          exposure_id?: string | null
          id?: string
          import_batch_id?: string | null
          invoice_attachment_name?: string
          invoice_attachment_path?: string
          invoice_attachment_size?: number
          invoice_attachment_type?: string
          notes?: string
          paid_at?: string | null
          paid_date?: string | null
          payment_method?: string
          payment_reference?: string
          project_id: string
          reference_number?: string
          source_external_id?: string
          source_row_hash?: string
          status?: string
          subcontract_change_order_id?: string | null
          subcontract_payment_id?: string | null
          updated_at?: string
          vendor?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          amount_cents?: number
          approved_at?: string | null
          approved_by?: string | null
          budget_open_relief?: number
          category?: string
          cost_bucket_id?: string | null
          cost_code?: string
          cost_date?: string
          cost_document_id?: string
          created_at?: string
          created_by?: string | null
          credit_applies_to_id?: string | null
          daily_wip_offset?: number
          daily_wip_offset_cents?: number
          description?: string
          exposure_id?: string | null
          id?: string
          import_batch_id?: string | null
          invoice_attachment_name?: string
          invoice_attachment_path?: string
          invoice_attachment_size?: number
          invoice_attachment_type?: string
          notes?: string
          paid_at?: string | null
          paid_date?: string | null
          payment_method?: string
          payment_reference?: string
          project_id?: string
          reference_number?: string
          source_external_id?: string
          source_row_hash?: string
          status?: string
          subcontract_change_order_id?: string | null
          subcontract_payment_id?: string | null
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
            foreignKeyName: "cost_actuals_credit_applies_to_id_fkey"
            columns: ["credit_applies_to_id"]
            isOneToOne: false
            referencedRelation: "cost_actuals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_actuals_exposure_id_fkey"
            columns: ["exposure_id"]
            isOneToOne: false
            referencedRelation: "exposures"
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
          {
            foreignKeyName: "cost_actuals_subcontract_change_order_id_fkey"
            columns: ["subcontract_change_order_id"]
            isOneToOne: false
            referencedRelation: "subcontract_change_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_actuals_subcontract_payment_id_fkey"
            columns: ["subcontract_payment_id"]
            isOneToOne: false
            referencedRelation: "subcontract_payments"
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
          contract_value: number
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
          contract_value?: number
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
          contract_value?: number
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
      cost_budget_items: {
        Row: {
          category: string
          cost_bucket_id: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          planned_amount_cents: number
          project_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category?: string
          cost_bucket_id: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          planned_amount_cents?: number
          project_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          cost_bucket_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          planned_amount_cents?: number
          project_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_budget_items_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_budget_items_project_id_fkey"
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
          effective_date: string | null
          escalation_pct: number
          expires_at: string | null
          external_id: string
          id: string
          keywords: Json
          labor_basis: string
          labor_cost_cents: number
          material_cost_cents: number
          organization_id: string
          productivity_per_hour: number | null
          source: string
          source_reference: string
          source_vendor: string
          synonyms: Json
          unit: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          version_no: number
        }
        Insert: {
          base_region?: string
          category?: string
          created_at?: string
          crew_size?: number | null
          csi_code?: string
          csi_division: string
          description: string
          effective_date?: string | null
          escalation_pct?: number
          expires_at?: string | null
          external_id?: string
          id?: string
          keywords?: Json
          labor_basis?: string
          labor_cost_cents?: number
          material_cost_cents?: number
          organization_id: string
          productivity_per_hour?: number | null
          source?: string
          source_reference?: string
          source_vendor?: string
          synonyms?: Json
          unit: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          version_no?: number
        }
        Update: {
          base_region?: string
          category?: string
          created_at?: string
          crew_size?: number | null
          csi_code?: string
          csi_division?: string
          description?: string
          effective_date?: string | null
          escalation_pct?: number
          expires_at?: string | null
          external_id?: string
          id?: string
          keywords?: Json
          labor_basis?: string
          labor_cost_cents?: number
          material_cost_cents?: number
          organization_id?: string
          productivity_per_hour?: number | null
          source?: string
          source_reference?: string
          source_vendor?: string
          synonyms?: Json
          unit?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          version_no?: number
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
      cost_library_price_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          cost_library_item_id: string
          crew_size: number | null
          effective_date: string | null
          escalation_pct: number
          expires_at: string | null
          id: string
          labor_basis: string
          labor_cost_cents: number
          material_cost_cents: number
          organization_id: string
          productivity_per_hour: number | null
          source_reference: string
          source_vendor: string
          version_no: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          cost_library_item_id: string
          crew_size?: number | null
          effective_date?: string | null
          escalation_pct?: number
          expires_at?: string | null
          id?: string
          labor_basis?: string
          labor_cost_cents?: number
          material_cost_cents?: number
          organization_id: string
          productivity_per_hour?: number | null
          source_reference?: string
          source_vendor?: string
          version_no: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          cost_library_item_id?: string
          crew_size?: number | null
          effective_date?: string | null
          escalation_pct?: number
          expires_at?: string | null
          id?: string
          labor_basis?: string
          labor_cost_cents?: number
          material_cost_cents?: number
          organization_id?: string
          productivity_per_hour?: number | null
          source_reference?: string
          source_vendor?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "cost_library_price_history_cost_library_item_id_fkey"
            columns: ["cost_library_item_id"]
            isOneToOne: false
            referencedRelation: "cost_library_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_library_price_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: string
          organization_id: string
          reason: string
          reference: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          organization_id: string
          reason: string
          reference?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          organization_id?: string
          reason?: string
          reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_followup_enrollments: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          opportunity_id: string
          organization_id: string
          owner_user_id: string | null
          paused_at: string | null
          playbook_id: string
          started_at: string
          status: string
          stop_reason: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          opportunity_id: string
          organization_id: string
          owner_user_id?: string | null
          paused_at?: string | null
          playbook_id: string
          started_at?: string
          status?: string
          stop_reason?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          opportunity_id?: string
          organization_id?: string
          owner_user_id?: string | null
          paused_at?: string | null
          playbook_id?: string
          started_at?: string
          status?: string
          stop_reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_followup_enrollments_opportunity_id_organization_id_fkey"
            columns: ["opportunity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pipeline_opportunities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "crm_followup_enrollments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_followup_enrollments_playbook_id_organization_id_fkey"
            columns: ["playbook_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "crm_followup_playbooks"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      crm_followup_playbook_steps: {
        Row: {
          active: boolean
          body_template: string
          channel: string
          created_at: string
          created_by: string | null
          day_offset: number
          default_asset_id: string | null
          id: string
          organization_id: string
          playbook_id: string
          purpose: string
          require_review: boolean
          step_order: number
          subject_template: string
          title: string
          updated_at: string
          value_angle: string
        }
        Insert: {
          active?: boolean
          body_template?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          day_offset?: number
          default_asset_id?: string | null
          id?: string
          organization_id: string
          playbook_id: string
          purpose?: string
          require_review?: boolean
          step_order: number
          subject_template?: string
          title: string
          updated_at?: string
          value_angle?: string
        }
        Update: {
          active?: boolean
          body_template?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          day_offset?: number
          default_asset_id?: string | null
          id?: string
          organization_id?: string
          playbook_id?: string
          purpose?: string
          require_review?: boolean
          step_order?: number
          subject_template?: string
          title?: string
          updated_at?: string
          value_angle?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_followup_playbook_steps_default_asset_id_organization__fkey"
            columns: ["default_asset_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "crm_value_assets"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "crm_followup_playbook_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_followup_playbook_steps_playbook_id_organization_id_fkey"
            columns: ["playbook_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "crm_followup_playbooks"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      crm_followup_playbooks: {
        Row: {
          active: boolean
          audience: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          is_system: boolean
          name: string
          organization_id: string
          system_key: string
          trigger_stage: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          audience?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          is_system?: boolean
          name: string
          organization_id: string
          system_key?: string
          trigger_stage?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          audience?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string
          system_key?: string
          trigger_stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_followup_playbooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_meeting_briefs: {
        Row: {
          ai_operation_id: string | null
          attendee_names: string[]
          brief_data: Json
          created_at: string
          created_by: string | null
          generated_at: string | null
          id: string
          meeting_at: string | null
          meeting_goal: string
          meeting_type: string
          model_used: string
          opportunity_id: string
          organization_id: string
          owner_user_id: string | null
          source_context: Json
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_operation_id?: string | null
          attendee_names?: string[]
          brief_data?: Json
          created_at?: string
          created_by?: string | null
          generated_at?: string | null
          id?: string
          meeting_at?: string | null
          meeting_goal?: string
          meeting_type?: string
          model_used?: string
          opportunity_id: string
          organization_id: string
          owner_user_id?: string | null
          source_context?: Json
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_operation_id?: string | null
          attendee_names?: string[]
          brief_data?: Json
          created_at?: string
          created_by?: string | null
          generated_at?: string | null
          id?: string
          meeting_at?: string | null
          meeting_goal?: string
          meeting_type?: string
          model_used?: string
          opportunity_id?: string
          organization_id?: string
          owner_user_id?: string | null
          source_context?: Json
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_meeting_briefs_ai_operation_id_organization_id_fkey"
            columns: ["ai_operation_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "ai_operations"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "crm_meeting_briefs_opportunity_id_organization_id_fkey"
            columns: ["opportunity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pipeline_opportunities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "crm_meeting_briefs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_onboarding_plans: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          handoff_summary: string
          id: string
          kickoff_date: string | null
          opportunity_id: string
          organization_id: string
          owner_user_id: string | null
          project_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          handoff_summary?: string
          id?: string
          kickoff_date?: string | null
          opportunity_id: string
          organization_id: string
          owner_user_id?: string | null
          project_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          handoff_summary?: string
          id?: string
          kickoff_date?: string | null
          opportunity_id?: string
          organization_id?: string
          owner_user_id?: string | null
          project_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_onboarding_plans_opportunity_id_organization_id_fkey"
            columns: ["opportunity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pipeline_opportunities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "crm_onboarding_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_onboarding_plans_project_id_organization_id_fkey"
            columns: ["project_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      crm_onboarding_tasks: {
        Row: {
          assigned_to: string | null
          category: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          description: string
          due_date: string | null
          due_offset_days: number
          id: string
          organization_id: string
          plan_id: string
          status: string
          step_order: number
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          due_offset_days?: number
          id?: string
          organization_id: string
          plan_id: string
          status?: string
          step_order: number
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          due_offset_days?: number
          id?: string
          organization_id?: string
          plan_id?: string
          status?: string
          step_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_onboarding_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_onboarding_tasks_plan_id_organization_id_fkey"
            columns: ["plan_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "crm_onboarding_plans"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      crm_outbound_messages: {
        Row: {
          body_text: string
          client_request_id: string
          created_at: string
          created_by: string | null
          error_message: string
          id: string
          next_action_id: string | null
          opportunity_id: string
          organization_id: string
          provider: string
          provider_message_id: string
          recipient_email: string
          reply_to_email: string
          sent_at: string | null
          sent_by: string | null
          status: string
          subject: string
          updated_at: string
          value_asset_id: string | null
        }
        Insert: {
          body_text: string
          client_request_id: string
          created_at?: string
          created_by?: string | null
          error_message?: string
          id?: string
          next_action_id?: string | null
          opportunity_id: string
          organization_id: string
          provider?: string
          provider_message_id?: string
          recipient_email: string
          reply_to_email?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          subject: string
          updated_at?: string
          value_asset_id?: string | null
        }
        Update: {
          body_text?: string
          client_request_id?: string
          created_at?: string
          created_by?: string | null
          error_message?: string
          id?: string
          next_action_id?: string | null
          opportunity_id?: string
          organization_id?: string
          provider?: string
          provider_message_id?: string
          recipient_email?: string
          reply_to_email?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          subject?: string
          updated_at?: string
          value_asset_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_outbound_messages_next_action_id_organization_id_fkey"
            columns: ["next_action_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pipeline_next_actions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "crm_outbound_messages_opportunity_id_organization_id_fkey"
            columns: ["opportunity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pipeline_opportunities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "crm_outbound_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_outbound_messages_value_asset_id_organization_id_fkey"
            columns: ["value_asset_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "crm_value_assets"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      crm_value_assets: {
        Row: {
          approved_for_external: boolean
          archived: boolean
          audience: string
          content_type: string
          created_at: string
          created_by: string | null
          description: string
          external_url: string
          id: string
          organization_id: string
          original_file_name: string
          pipeline_stage: string
          size_bytes: number
          source_type: string
          storage_path: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          approved_for_external?: boolean
          archived?: boolean
          audience?: string
          content_type?: string
          created_at?: string
          created_by?: string | null
          description?: string
          external_url?: string
          id?: string
          organization_id: string
          original_file_name?: string
          pipeline_stage?: string
          size_bytes?: number
          source_type?: string
          storage_path?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          approved_for_external?: boolean
          archived?: boolean
          audience?: string
          content_type?: string
          created_at?: string
          created_by?: string | null
          description?: string
          external_url?: string
          id?: string
          organization_id?: string
          original_file_name?: string
          pipeline_stage?: string
          size_bytes?: number
          source_type?: string
          storage_path?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_value_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reports: {
        Row: {
          attachment_bytes: number
          attachment_count: number
          attachment_manifest: Json
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
          manpower: string
          notes: string
          project_id: string
          quality_notes: string
          report_date: string
          safety_notes: string
          updated_at: string
          visitors: string
          weather: string
          work_performed: string
        }
        Insert: {
          attachment_bytes?: number
          attachment_count?: number
          attachment_manifest?: Json
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
          manpower?: string
          notes?: string
          project_id: string
          quality_notes?: string
          report_date?: string
          safety_notes?: string
          updated_at?: string
          visitors?: string
          weather?: string
          work_performed?: string
        }
        Update: {
          attachment_bytes?: number
          attachment_count?: number
          attachment_manifest?: Json
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
          manpower?: string
          notes?: string
          project_id?: string
          quality_notes?: string
          report_date?: string
          safety_notes?: string
          updated_at?: string
          visitors?: string
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
      daily_wip_entries: {
        Row: {
          activity: string
          cost_bucket_id: string | null
          created_at: string
          created_by: string | null
          crew_count: number
          entry_date: string
          equipment_cost: number
          equipment_cost_cents: number
          equipment_items: Json
          field_percent_complete: number
          hours: number
          id: string
          labor_rate: number
          labor_rate_cents: number
          material_cost: number
          material_cost_cents: number
          material_items: Json
          notes: string
          people_per_crew: number
          percent_basis: string
          percent_complete: number
          percent_overridden_at: string | null
          project_id: string
          quantity: number
          quantity_items: Json
          review_version: number
          schedule_activity_id: string | null
          subcontractor_id: string | null
          target_production_rate: number | null
          unit: string
          unmatched_vendor_name: string
          updated_at: string
          version: number
          void_reason: string
          voided_at: string | null
          voided_by: string | null
          wip_reviewed_at: string | null
          wip_reviewed_by: string | null
        }
        Insert: {
          activity?: string
          cost_bucket_id?: string | null
          created_at?: string
          created_by?: string | null
          crew_count?: number
          entry_date: string
          equipment_cost?: number
          equipment_cost_cents?: number
          equipment_items?: Json
          field_percent_complete?: number
          hours?: number
          id?: string
          labor_rate?: number
          labor_rate_cents?: number
          material_cost?: number
          material_cost_cents?: number
          material_items?: Json
          notes?: string
          people_per_crew?: number
          percent_basis?: string
          percent_complete?: number
          percent_overridden_at?: string | null
          project_id: string
          quantity?: number
          quantity_items?: Json
          review_version?: number
          schedule_activity_id?: string | null
          subcontractor_id?: string | null
          target_production_rate?: number | null
          unit?: string
          unmatched_vendor_name?: string
          updated_at?: string
          version?: number
          void_reason?: string
          voided_at?: string | null
          voided_by?: string | null
          wip_reviewed_at?: string | null
          wip_reviewed_by?: string | null
        }
        Update: {
          activity?: string
          cost_bucket_id?: string | null
          created_at?: string
          created_by?: string | null
          crew_count?: number
          entry_date?: string
          equipment_cost?: number
          equipment_cost_cents?: number
          equipment_items?: Json
          field_percent_complete?: number
          hours?: number
          id?: string
          labor_rate?: number
          labor_rate_cents?: number
          material_cost?: number
          material_cost_cents?: number
          material_items?: Json
          notes?: string
          people_per_crew?: number
          percent_basis?: string
          percent_complete?: number
          percent_overridden_at?: string | null
          project_id?: string
          quantity?: number
          quantity_items?: Json
          review_version?: number
          schedule_activity_id?: string | null
          subcontractor_id?: string | null
          target_production_rate?: number | null
          unit?: string
          unmatched_vendor_name?: string
          updated_at?: string
          version?: number
          void_reason?: string
          voided_at?: string | null
          voided_by?: string | null
          wip_reviewed_at?: string | null
          wip_reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_wip_entries_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_wip_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_wip_entries_schedule_activity_id_fkey"
            columns: ["schedule_activity_id"]
            isOneToOne: false
            referencedRelation: "schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_wip_entries_subcontractor_id_fkey"
            columns: ["subcontractor_id"]
            isOneToOne: false
            referencedRelation: "subcontractors"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_wip_entry_events: {
        Row: {
          after_snapshot: Json | null
          before_snapshot: Json | null
          created_at: string
          created_by: string
          daily_wip_entry_id: string
          event_type: string
          id: string
          operation_key: string
          project_id: string
        }
        Insert: {
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          created_at?: string
          created_by: string
          daily_wip_entry_id: string
          event_type: string
          id?: string
          operation_key: string
          project_id: string
        }
        Update: {
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          created_at?: string
          created_by?: string
          daily_wip_entry_id?: string
          event_type?: string
          id?: string
          operation_key?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_wip_entry_events_project_id_fkey"
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
            foreignKeyName: "decisions_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      demo_seed_module_versions: {
        Row: {
          applied_version: number
          created_at: string
          first_seeded_at: string
          last_error: string
          last_operation: string
          last_reset_at: string | null
          last_seeded_at: string
          last_seeded_by: string
          metadata: Json
          module_key: string
          project_id: string
          status: string
          updated_at: string
        }
        Insert: {
          applied_version?: number
          created_at?: string
          first_seeded_at?: string
          last_error?: string
          last_operation?: string
          last_reset_at?: string | null
          last_seeded_at?: string
          last_seeded_by?: string
          metadata?: Json
          module_key: string
          project_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          applied_version?: number
          created_at?: string
          first_seeded_at?: string
          last_error?: string
          last_operation?: string
          last_reset_at?: string | null
          last_seeded_at?: string
          last_seeded_by?: string
          metadata?: Json
          module_key?: string
          project_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_seed_module_versions_project_id_fkey"
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
      estimate_alternates: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          decision: string
          description: string
          estimate_id: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          decision?: string
          description?: string
          estimate_id: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          decision?: string
          description?: string
          estimate_id?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_alternates_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_bid_packages: {
        Row: {
          created_at: string
          created_by: string | null
          due_date: string | null
          estimate_id: string
          id: string
          name: string
          scope: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          estimate_id: string
          id?: string
          name: string
          scope?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          estimate_id?: string
          id?: string
          name?: string
          scope?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_bid_packages_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_commercial_notes: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          estimate_id: string
          id: string
          note_type: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description: string
          estimate_id: string
          id?: string
          note_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          estimate_id?: string
          id?: string
          note_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_commercial_notes_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_create_operations: {
        Row: {
          changed_by: string
          created_at: string
          estimate_id: string
          id: string
          operation_key: string
          organization_id: string
          request_fingerprint: string
          result: Json
        }
        Insert: {
          changed_by: string
          created_at?: string
          estimate_id: string
          id?: string
          operation_key: string
          organization_id: string
          request_fingerprint: string
          result?: Json
        }
        Update: {
          changed_by?: string
          created_at?: string
          estimate_id?: string
          id?: string
          operation_key?: string
          organization_id?: string
          request_fingerprint?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "estimate_create_operations_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_create_operations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_duplicate_operations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          mode: string
          operation_key: string
          result: Json
          result_estimate_id: string
          source_estimate_id: string
          source_revision_fingerprint: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          mode: string
          operation_key: string
          result: Json
          result_estimate_id: string
          source_estimate_id: string
          source_revision_fingerprint: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          mode?: string
          operation_key?: string
          result?: Json
          result_estimate_id?: string
          source_estimate_id?: string
          source_revision_fingerprint?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_duplicate_operations_source_estimate_id_fkey"
            columns: ["source_estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_import_operations: {
        Row: {
          created_at: string
          created_by: string | null
          estimate_id: string
          idempotency_fingerprint: string
          idempotency_key: string
          result: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          estimate_id: string
          idempotency_fingerprint: string
          idempotency_key: string
          result: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          estimate_id?: string
          idempotency_fingerprint?: string
          idempotency_key?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "estimate_import_operations_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_line_items: {
        Row: {
          assembly_output_quantity: number | null
          assembly_output_synced_at: string | null
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
          quantity_source: string
          scope_group: string
          sort_order: number
          takeoff_quantity: number | null
          takeoff_synced_at: string | null
          takeoff_unit: string | null
          total_extended_cents: number | null
          unit: string
          updated_at: string
        }
        Insert: {
          assembly_output_quantity?: number | null
          assembly_output_synced_at?: string | null
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
          quantity_source?: string
          scope_group?: string
          sort_order?: number
          takeoff_quantity?: number | null
          takeoff_synced_at?: string | null
          takeoff_unit?: string | null
          total_extended_cents?: number | null
          unit: string
          updated_at?: string
        }
        Update: {
          assembly_output_quantity?: number | null
          assembly_output_synced_at?: string | null
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
          quantity_source?: string
          scope_group?: string
          sort_order?: number
          takeoff_quantity?: number | null
          takeoff_synced_at?: string | null
          takeoff_unit?: string | null
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
      estimate_line_operations: {
        Row: {
          changed_by: string
          created_at: string
          estimate_id: string
          id: string
          line_item_id: string | null
          operation_key: string
          operation_type: string
          request_fingerprint: string
          result: Json
        }
        Insert: {
          changed_by: string
          created_at?: string
          estimate_id: string
          id?: string
          line_item_id?: string | null
          operation_key: string
          operation_type: string
          request_fingerprint: string
          result?: Json
        }
        Update: {
          changed_by?: string
          created_at?: string
          estimate_id?: string
          id?: string
          line_item_id?: string | null
          operation_key?: string
          operation_type?: string
          request_fingerprint?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "estimate_line_operations_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
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
      estimate_measurement_scope_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          estimate_id: string
          id: string
          proposal_snapshot: Json
          scope_item_id: string
          takeoff_measurement_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          estimate_id: string
          id?: string
          proposal_snapshot?: Json
          scope_item_id: string
          takeoff_measurement_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          estimate_id?: string
          id?: string
          proposal_snapshot?: Json
          scope_item_id?: string
          takeoff_measurement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimate_measurement_scope_events_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_measurement_scope_events_scope_item_id_fkey"
            columns: ["scope_item_id"]
            isOneToOne: false
            referencedRelation: "estimate_measurement_scope_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_measurement_scope_events_takeoff_measurement_id_fkey"
            columns: ["takeoff_measurement_id"]
            isOneToOne: false
            referencedRelation: "estimate_takeoff_measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_measurement_scope_items: {
        Row: {
          ai_operation_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          decision_at: string
          decision_by: string | null
          estimate_id: string
          estimate_line_item_id: string | null
          guide_geometry: Json
          guide_source: string | null
          id: string
          label: string
          library_item_id: string | null
          plan_sheet_id: string
          scope_key: string
          source_anchor: Json
          source_excerpt: string
          source_line: string
          status: string
          suggestion_key: string
          takeoff_measurement_id: string | null
          tool_type: string
          unit: string
          updated_at: string
        }
        Insert: {
          ai_operation_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          decision_at?: string
          decision_by?: string | null
          estimate_id: string
          estimate_line_item_id?: string | null
          guide_geometry?: Json
          guide_source?: string | null
          id?: string
          label: string
          library_item_id?: string | null
          plan_sheet_id: string
          scope_key: string
          source_anchor?: Json
          source_excerpt: string
          source_line: string
          status?: string
          suggestion_key: string
          takeoff_measurement_id?: string | null
          tool_type: string
          unit: string
          updated_at?: string
        }
        Update: {
          ai_operation_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          decision_at?: string
          decision_by?: string | null
          estimate_id?: string
          estimate_line_item_id?: string | null
          guide_geometry?: Json
          guide_source?: string | null
          id?: string
          label?: string
          library_item_id?: string | null
          plan_sheet_id?: string
          scope_key?: string
          source_anchor?: Json
          source_excerpt?: string
          source_line?: string
          status?: string
          suggestion_key?: string
          takeoff_measurement_id?: string | null
          tool_type?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_measurement_scope_items_ai_operation_id_fkey"
            columns: ["ai_operation_id"]
            isOneToOne: false
            referencedRelation: "ai_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_measurement_scope_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_measurement_scope_items_estimate_line_item_id_fkey"
            columns: ["estimate_line_item_id"]
            isOneToOne: false
            referencedRelation: "estimate_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_measurement_scope_items_library_item_id_fkey"
            columns: ["library_item_id"]
            isOneToOne: false
            referencedRelation: "cost_library_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_measurement_scope_items_plan_sheet_id_fkey"
            columns: ["plan_sheet_id"]
            isOneToOne: false
            referencedRelation: "estimate_plan_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_measurement_scope_items_takeoff_measurement_id_fkey"
            columns: ["takeoff_measurement_id"]
            isOneToOne: false
            referencedRelation: "estimate_takeoff_measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_plan_revision_impact_reviews: {
        Row: {
          base_sheet_id: string
          created_at: string
          disposition: string
          estimate_id: string
          id: string
          impacts: Json
          reviewed_at: string
          reviewed_by: string | null
          revision_match_id: string
          revision_sheet_id: string
          summary_notes: string
          version: number
        }
        Insert: {
          base_sheet_id: string
          created_at?: string
          disposition: string
          estimate_id: string
          id?: string
          impacts?: Json
          reviewed_at?: string
          reviewed_by?: string | null
          revision_match_id: string
          revision_sheet_id: string
          summary_notes?: string
          version: number
        }
        Update: {
          base_sheet_id?: string
          created_at?: string
          disposition?: string
          estimate_id?: string
          id?: string
          impacts?: Json
          reviewed_at?: string
          reviewed_by?: string | null
          revision_match_id?: string
          revision_sheet_id?: string
          summary_notes?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_plan_revision_impact_reviews_base_sheet_id_fkey"
            columns: ["base_sheet_id"]
            isOneToOne: false
            referencedRelation: "estimate_plan_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_plan_revision_impact_reviews_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_plan_revision_impact_reviews_revision_match_id_fkey"
            columns: ["revision_match_id"]
            isOneToOne: false
            referencedRelation: "estimate_plan_revision_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_plan_revision_impact_reviews_revision_sheet_id_fkey"
            columns: ["revision_sheet_id"]
            isOneToOne: false
            referencedRelation: "estimate_plan_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_plan_revision_match_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          estimate_id: string
          id: string
          match_id: string
          snapshot: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          estimate_id: string
          id?: string
          match_id: string
          snapshot: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          estimate_id?: string
          id?: string
          match_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "estimate_plan_revision_match_events_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_plan_revision_match_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "estimate_plan_revision_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_plan_revision_matches: {
        Row: {
          ai_operation_id: string | null
          base_sheet_id: string | null
          confidence: number
          created_at: string
          estimate_id: string
          evidence: Json
          id: string
          proposal_method: string
          reason: string
          review_action: string
          reviewed_at: string
          reviewed_by: string | null
          revision_plan_set_id: string
          revision_sheet_id: string
          updated_at: string
        }
        Insert: {
          ai_operation_id?: string | null
          base_sheet_id?: string | null
          confidence?: number
          created_at?: string
          estimate_id: string
          evidence?: Json
          id?: string
          proposal_method: string
          reason?: string
          review_action: string
          reviewed_at?: string
          reviewed_by?: string | null
          revision_plan_set_id: string
          revision_sheet_id: string
          updated_at?: string
        }
        Update: {
          ai_operation_id?: string | null
          base_sheet_id?: string | null
          confidence?: number
          created_at?: string
          estimate_id?: string
          evidence?: Json
          id?: string
          proposal_method?: string
          reason?: string
          review_action?: string
          reviewed_at?: string
          reviewed_by?: string | null
          revision_plan_set_id?: string
          revision_sheet_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_plan_revision_matches_ai_operation_id_fkey"
            columns: ["ai_operation_id"]
            isOneToOne: false
            referencedRelation: "ai_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_plan_revision_matches_base_sheet_id_fkey"
            columns: ["base_sheet_id"]
            isOneToOne: false
            referencedRelation: "estimate_plan_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_plan_revision_matches_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_plan_revision_matches_revision_plan_set_id_fkey"
            columns: ["revision_plan_set_id"]
            isOneToOne: false
            referencedRelation: "estimate_plan_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_plan_revision_matches_revision_sheet_id_fkey"
            columns: ["revision_sheet_id"]
            isOneToOne: true
            referencedRelation: "estimate_plan_sheets"
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
          scale_changed_at: string | null
          scale_feet_per_pixel: number
          scale_label: string
          scale_revision: number
          scale_source: string
          scale_verified_at: string | null
          sheet_name: string
          sheet_number: string
          sort_order: number
          thumbnail_path: string
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
          scale_changed_at?: string | null
          scale_feet_per_pixel?: number
          scale_label?: string
          scale_revision?: number
          scale_source?: string
          scale_verified_at?: string | null
          sheet_name?: string
          sheet_number?: string
          sort_order?: number
          thumbnail_path?: string
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
          scale_changed_at?: string | null
          scale_feet_per_pixel?: number
          scale_label?: string
          scale_revision?: number
          scale_source?: string
          scale_verified_at?: string | null
          sheet_name?: string
          sheet_number?: string
          sort_order?: number
          thumbnail_path?: string
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
      estimate_review_activities: {
        Row: {
          activity_type: string
          blocker_count: number
          created_at: string
          estimate_id: string
          follow_up_count: number
          id: string
          note: string
          organization_id: string
          reviewed_at: string
          reviewed_by: string
          sequence: number
          snapshot: Json
          snapshot_hash: string
          total_cents: number
        }
        Insert: {
          activity_type: string
          blocker_count: number
          created_at?: string
          estimate_id: string
          follow_up_count: number
          id?: string
          note: string
          organization_id: string
          reviewed_at?: string
          reviewed_by: string
          sequence: number
          snapshot: Json
          snapshot_hash: string
          total_cents: number
        }
        Update: {
          activity_type?: string
          blocker_count?: number
          created_at?: string
          estimate_id?: string
          follow_up_count?: number
          id?: string
          note?: string
          organization_id?: string
          reviewed_at?: string
          reviewed_by?: string
          sequence?: number
          snapshot?: Json
          snapshot_hash?: string
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_review_activities_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_review_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_scale_assessments: {
        Row: {
          created_at: string
          created_by: string | null
          estimate_id: string
          evidence: Json
          id: string
          max_variance_pct: number
          notes: string
          outcome: string
          plan_sheet_id: string
          scale_revision: number
          scale_spread_pct: number
          tolerance_pct: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          estimate_id: string
          evidence?: Json
          id?: string
          max_variance_pct: number
          notes?: string
          outcome: string
          plan_sheet_id: string
          scale_revision: number
          scale_spread_pct: number
          tolerance_pct?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          estimate_id?: string
          evidence?: Json
          id?: string
          max_variance_pct?: number
          notes?: string
          outcome?: string
          plan_sheet_id?: string
          scale_revision?: number
          scale_spread_pct?: number
          tolerance_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_scale_assessments_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_scale_assessments_plan_sheet_id_fkey"
            columns: ["plan_sheet_id"]
            isOneToOne: false
            referencedRelation: "estimate_plan_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_scope_brief_reviews: {
        Row: {
          ai_operation_id: string
          created_at: string
          estimate_id: string
          id: string
          item_id: string
          next_action: string
          plan_set_id: string
          plan_sheet_id: string
          review_kind: string
          review_notes: string
          reviewed_at: string
          reviewed_by: string | null
          scope_label: string
          source_excerpt: string
          source_line: string
          status: string
          trade: string
          version: number
        }
        Insert: {
          ai_operation_id: string
          created_at?: string
          estimate_id: string
          id?: string
          item_id: string
          next_action: string
          plan_set_id: string
          plan_sheet_id: string
          review_kind: string
          review_notes?: string
          reviewed_at?: string
          reviewed_by?: string | null
          scope_label: string
          source_excerpt: string
          source_line: string
          status: string
          trade: string
          version: number
        }
        Update: {
          ai_operation_id?: string
          created_at?: string
          estimate_id?: string
          id?: string
          item_id?: string
          next_action?: string
          plan_set_id?: string
          plan_sheet_id?: string
          review_kind?: string
          review_notes?: string
          reviewed_at?: string
          reviewed_by?: string | null
          scope_label?: string
          source_excerpt?: string
          source_line?: string
          status?: string
          trade?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_scope_brief_reviews_ai_operation_id_fkey"
            columns: ["ai_operation_id"]
            isOneToOne: false
            referencedRelation: "ai_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_scope_brief_reviews_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_scope_brief_reviews_plan_set_id_fkey"
            columns: ["plan_set_id"]
            isOneToOne: false
            referencedRelation: "estimate_plan_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_scope_brief_reviews_plan_sheet_id_fkey"
            columns: ["plan_sheet_id"]
            isOneToOne: false
            referencedRelation: "estimate_plan_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_sov_conversion_operations: {
        Row: {
          changed_by: string | null
          created_at: string
          estimate_id: string
          id: string
          operation_key: string
          project_id: string
          request_fingerprint: string
          result: Json
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          estimate_id: string
          id?: string
          operation_key: string
          project_id: string
          request_fingerprint: string
          result: Json
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          estimate_id?: string
          id?: string
          operation_key?: string
          project_id?: string
          request_fingerprint?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "estimate_sov_conversion_operations_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_sov_conversion_operations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_takeoff_assemblies: {
        Row: {
          ai_operation_id: string | null
          ai_proposals: Json
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_inputs: Json
          created_at: string
          created_by: string | null
          derived_outputs: Json
          estimate_id: string
          formula_version: string
          geometry_calculation_scale_revision: number | null
          geometry_quantity: number
          geometry_unit: string
          id: string
          source_citations: Json
          status: string
          takeoff_measurement_id: string
          template_id: string
          updated_at: string
        }
        Insert: {
          ai_operation_id?: string | null
          ai_proposals?: Json
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_inputs?: Json
          created_at?: string
          created_by?: string | null
          derived_outputs?: Json
          estimate_id: string
          formula_version?: string
          geometry_calculation_scale_revision?: number | null
          geometry_quantity: number
          geometry_unit: string
          id?: string
          source_citations?: Json
          status?: string
          takeoff_measurement_id: string
          template_id: string
          updated_at?: string
        }
        Update: {
          ai_operation_id?: string | null
          ai_proposals?: Json
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_inputs?: Json
          created_at?: string
          created_by?: string | null
          derived_outputs?: Json
          estimate_id?: string
          formula_version?: string
          geometry_calculation_scale_revision?: number | null
          geometry_quantity?: number
          geometry_unit?: string
          id?: string
          source_citations?: Json
          status?: string
          takeoff_measurement_id?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_takeoff_assemblies_ai_operation_id_fkey"
            columns: ["ai_operation_id"]
            isOneToOne: false
            referencedRelation: "ai_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_takeoff_assemblies_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_takeoff_assemblies_takeoff_measurement_id_fkey"
            columns: ["takeoff_measurement_id"]
            isOneToOne: true
            referencedRelation: "estimate_takeoff_measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_takeoff_assembly_events: {
        Row: {
          action: string
          actor_id: string | null
          ai_operation_id: string | null
          ai_proposals: Json
          assembly_id: string
          confirmed_inputs: Json
          created_at: string
          derived_outputs: Json
          estimate_id: string
          formula_version: string
          geometry_calculation_scale_revision: number | null
          geometry_quantity: number
          geometry_unit: string
          id: string
          source_citations: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          ai_operation_id?: string | null
          ai_proposals: Json
          assembly_id: string
          confirmed_inputs: Json
          created_at?: string
          derived_outputs: Json
          estimate_id: string
          formula_version: string
          geometry_calculation_scale_revision?: number | null
          geometry_quantity: number
          geometry_unit: string
          id?: string
          source_citations: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          ai_operation_id?: string | null
          ai_proposals?: Json
          assembly_id?: string
          confirmed_inputs?: Json
          created_at?: string
          derived_outputs?: Json
          estimate_id?: string
          formula_version?: string
          geometry_calculation_scale_revision?: number | null
          geometry_quantity?: number
          geometry_unit?: string
          id?: string
          source_citations?: Json
        }
        Relationships: [
          {
            foreignKeyName: "estimate_takeoff_assembly_events_ai_operation_id_fkey"
            columns: ["ai_operation_id"]
            isOneToOne: false
            referencedRelation: "ai_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_takeoff_assembly_events_assembly_id_fkey"
            columns: ["assembly_id"]
            isOneToOne: false
            referencedRelation: "estimate_takeoff_assemblies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_takeoff_assembly_events_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_takeoff_assembly_output_link_events: {
        Row: {
          action: string
          actor_id: string | null
          assembly_id: string
          created_at: string
          estimate_id: string
          estimate_line_item_id: string | null
          formula_version: string
          id: string
          link_id: string | null
          output_key: string
          output_label: string
          output_quantity: number
          output_unit: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          assembly_id: string
          created_at?: string
          estimate_id: string
          estimate_line_item_id?: string | null
          formula_version: string
          id?: string
          link_id?: string | null
          output_key: string
          output_label: string
          output_quantity: number
          output_unit: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          assembly_id?: string
          created_at?: string
          estimate_id?: string
          estimate_line_item_id?: string | null
          formula_version?: string
          id?: string
          link_id?: string | null
          output_key?: string
          output_label?: string
          output_quantity?: number
          output_unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_takeoff_assembly_output_li_estimate_line_item_id_fkey1"
            columns: ["estimate_line_item_id"]
            isOneToOne: false
            referencedRelation: "estimate_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_takeoff_assembly_output_link_events_assembly_id_fkey"
            columns: ["assembly_id"]
            isOneToOne: false
            referencedRelation: "estimate_takeoff_assemblies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_takeoff_assembly_output_link_events_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_takeoff_assembly_output_link_events_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "estimate_takeoff_assembly_output_links"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_takeoff_assembly_output_links: {
        Row: {
          assembly_id: string
          created_at: string
          estimate_id: string
          estimate_line_item_id: string
          formula_version: string
          id: string
          last_synced_at: string
          linked_at: string
          linked_by: string | null
          output_key: string
          output_label: string
          output_quantity: number
          output_unit: string
          stale_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assembly_id: string
          created_at?: string
          estimate_id: string
          estimate_line_item_id: string
          formula_version: string
          id?: string
          last_synced_at?: string
          linked_at?: string
          linked_by?: string | null
          output_key: string
          output_label: string
          output_quantity: number
          output_unit: string
          stale_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assembly_id?: string
          created_at?: string
          estimate_id?: string
          estimate_line_item_id?: string
          formula_version?: string
          id?: string
          last_synced_at?: string
          linked_at?: string
          linked_by?: string | null
          output_key?: string
          output_label?: string
          output_quantity?: number
          output_unit?: string
          stale_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_takeoff_assembly_output_lin_estimate_line_item_id_fkey"
            columns: ["estimate_line_item_id"]
            isOneToOne: true
            referencedRelation: "estimate_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_takeoff_assembly_output_links_assembly_id_fkey"
            columns: ["assembly_id"]
            isOneToOne: false
            referencedRelation: "estimate_takeoff_assemblies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_takeoff_assembly_output_links_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_takeoff_assembly_outputs: {
        Row: {
          assembly_id: string
          created_at: string
          estimate_id: string
          formula: string
          id: string
          label: string
          output_key: string
          quantity: number
          rounding_method: string
          sort_order: number
          unit: string
        }
        Insert: {
          assembly_id: string
          created_at?: string
          estimate_id: string
          formula: string
          id?: string
          label: string
          output_key: string
          quantity: number
          rounding_method: string
          sort_order?: number
          unit: string
        }
        Update: {
          assembly_id?: string
          created_at?: string
          estimate_id?: string
          formula?: string
          id?: string
          label?: string
          output_key?: string
          quantity?: number
          rounding_method?: string
          sort_order?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_takeoff_assembly_outputs_assembly_id_fkey"
            columns: ["assembly_id"]
            isOneToOne: false
            referencedRelation: "estimate_takeoff_assemblies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_takeoff_assembly_outputs_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_takeoff_measurements: {
        Row: {
          ai_confidence: number | null
          ai_operation_id: string | null
          ai_original_geometry: Json | null
          ai_proposal_source: string | null
          ai_review_action: string | null
          ai_reviewed_at: string | null
          ai_reviewed_by: string | null
          calculated_at: string | null
          calculated_quantity: number | null
          calculation_context: Json
          calculation_method: string
          calculation_scale_revision: number | null
          calculation_status: string
          color: string
          created_at: string
          created_by: string | null
          created_by_ai: boolean
          estimate_id: string
          estimate_line_item_id: string | null
          geometry: Json
          id: string
          label: string
          library_item_id: string | null
          notes: string
          override_reason: string
          plan_sheet_id: string
          quantity: number
          scope_brief_review_id: string | null
          tool_type: string
          unit: string
          updated_at: string
          version: number
          waste_pct: number
        }
        Insert: {
          ai_confidence?: number | null
          ai_operation_id?: string | null
          ai_original_geometry?: Json | null
          ai_proposal_source?: string | null
          ai_review_action?: string | null
          ai_reviewed_at?: string | null
          ai_reviewed_by?: string | null
          calculated_at?: string | null
          calculated_quantity?: number | null
          calculation_context?: Json
          calculation_method?: string
          calculation_scale_revision?: number | null
          calculation_status?: string
          color?: string
          created_at?: string
          created_by?: string | null
          created_by_ai?: boolean
          estimate_id: string
          estimate_line_item_id?: string | null
          geometry?: Json
          id?: string
          label: string
          library_item_id?: string | null
          notes?: string
          override_reason?: string
          plan_sheet_id: string
          quantity?: number
          scope_brief_review_id?: string | null
          tool_type: string
          unit: string
          updated_at?: string
          version?: number
          waste_pct?: number
        }
        Update: {
          ai_confidence?: number | null
          ai_operation_id?: string | null
          ai_original_geometry?: Json | null
          ai_proposal_source?: string | null
          ai_review_action?: string | null
          ai_reviewed_at?: string | null
          ai_reviewed_by?: string | null
          calculated_at?: string | null
          calculated_quantity?: number | null
          calculation_context?: Json
          calculation_method?: string
          calculation_scale_revision?: number | null
          calculation_status?: string
          color?: string
          created_at?: string
          created_by?: string | null
          created_by_ai?: boolean
          estimate_id?: string
          estimate_line_item_id?: string | null
          geometry?: Json
          id?: string
          label?: string
          library_item_id?: string | null
          notes?: string
          override_reason?: string
          plan_sheet_id?: string
          quantity?: number
          scope_brief_review_id?: string | null
          tool_type?: string
          unit?: string
          updated_at?: string
          version?: number
          waste_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_takeoff_measurements_ai_operation_id_fkey"
            columns: ["ai_operation_id"]
            isOneToOne: false
            referencedRelation: "ai_operations"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "estimate_takeoff_measurements_scope_brief_review_id_fkey"
            columns: ["scope_brief_review_id"]
            isOneToOne: false
            referencedRelation: "estimate_scope_brief_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_takeoff_operations: {
        Row: {
          changed_by: string
          created_at: string
          estimate_id: string
          id: string
          measurement_id: string | null
          operation_key: string
          operation_type: string
          request_fingerprint: string
          result: Json
        }
        Insert: {
          changed_by: string
          created_at?: string
          estimate_id: string
          id?: string
          measurement_id?: string | null
          operation_key: string
          operation_type: string
          request_fingerprint: string
          result: Json
        }
        Update: {
          changed_by?: string
          created_at?: string
          estimate_id?: string
          id?: string
          measurement_id?: string | null
          operation_key?: string
          operation_type?: string
          request_fingerprint?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "estimate_takeoff_operations_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_vendor_quotes: {
        Row: {
          amount_cents: number
          bid_package_id: string | null
          created_at: string
          created_by: string | null
          estimate_id: string
          exclusions: string
          id: string
          inclusions: string
          received_at: string | null
          status: string
          updated_at: string
          vendor_name: string
        }
        Insert: {
          amount_cents?: number
          bid_package_id?: string | null
          created_at?: string
          created_by?: string | null
          estimate_id: string
          exclusions?: string
          id?: string
          inclusions?: string
          received_at?: string | null
          status?: string
          updated_at?: string
          vendor_name: string
        }
        Update: {
          amount_cents?: number
          bid_package_id?: string | null
          created_at?: string
          created_by?: string | null
          estimate_id?: string
          exclusions?: string
          id?: string
          inclusions?: string
          received_at?: string | null
          status?: string
          updated_at?: string
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_vendor_quotes_bid_package_id_fkey"
            columns: ["bid_package_id"]
            isOneToOne: false
            referencedRelation: "estimate_bid_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_vendor_quotes_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_versions: {
        Row: {
          created_at: string
          created_by: string | null
          estimate_id: string
          estimate_snapshot: Json
          id: string
          line_items_snapshot: Json
          name: string
          note: string
          subtotal_cents: number
          total_cents: number
          version_no: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          estimate_id: string
          estimate_snapshot?: Json
          id?: string
          line_items_snapshot?: Json
          name: string
          note?: string
          subtotal_cents?: number
          total_cents?: number
          version_no: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          estimate_id?: string
          estimate_snapshot?: Json
          id?: string
          line_items_snapshot?: Json
          name?: string
          note?: string
          subtotal_cents?: number
          total_cents?: number
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_versions_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimates: {
        Row: {
          bond_pct: number
          canonical_demo_key: string | null
          canonical_demo_version: number | null
          canonical_expected_total_cents: number | null
          contingency_pct: number
          created_at: string
          created_by: string | null
          custom_markups: Json
          description: string
          folder: string
          general_conditions_pct: number
          id: string
          is_canonical_demo: boolean
          kind: string
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
          canonical_demo_key?: string | null
          canonical_demo_version?: number | null
          canonical_expected_total_cents?: number | null
          contingency_pct?: number
          created_at?: string
          created_by?: string | null
          custom_markups?: Json
          description?: string
          folder?: string
          general_conditions_pct?: number
          id?: string
          is_canonical_demo?: boolean
          kind?: string
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
          canonical_demo_key?: string | null
          canonical_demo_version?: number | null
          canonical_expected_total_cents?: number | null
          contingency_pct?: number
          created_at?: string
          created_by?: string | null
          custom_markups?: Json
          description?: string
          folder?: string
          general_conditions_pct?: number
          id?: string
          is_canonical_demo?: boolean
          kind?: string
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
            foreignKeyName: "estimates_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "pipeline_opportunities"
            referencedColumns: ["id"]
          },
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
      exposure_allocation_operations: {
        Row: {
          allocation_id: string
          changed_by: string
          created_at: string
          exposure_id: string
          id: string
          operation_key: string
          operation_type: string
          project_id: string
          request_fingerprint: string
          result: Json
        }
        Insert: {
          allocation_id: string
          changed_by: string
          created_at?: string
          exposure_id: string
          id?: string
          operation_key: string
          operation_type: string
          project_id: string
          request_fingerprint: string
          result: Json
        }
        Update: {
          allocation_id?: string
          changed_by?: string
          created_at?: string
          exposure_id?: string
          id?: string
          operation_key?: string
          operation_type?: string
          project_id?: string
          request_fingerprint?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "exposure_allocation_operations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      exposure_allocations: {
        Row: {
          amount: number
          cost_bucket_id: string | null
          cost_code: string
          created_at: string
          exposure_id: string
          id: string
          project_id: string
          updated_at: string
          version: number
        }
        Insert: {
          amount?: number
          cost_bucket_id?: string | null
          cost_code?: string
          created_at?: string
          exposure_id: string
          id?: string
          project_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          amount?: number
          cost_bucket_id?: string | null
          cost_code?: string
          created_at?: string
          exposure_id?: string
          id?: string
          project_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "exposure_allocations_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exposure_allocations_exposure_id_fkey"
            columns: ["exposure_id"]
            isOneToOne: false
            referencedRelation: "exposures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exposure_allocations_project_id_fkey"
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
          linked_change_order_id: string | null
          linked_claim_id: string | null
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
          linked_change_order_id?: string | null
          linked_claim_id?: string | null
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
          linked_change_order_id?: string | null
          linked_claim_id?: string | null
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
            foreignKeyName: "exposures_linked_change_order_id_fkey"
            columns: ["linked_change_order_id"]
            isOneToOne: false
            referencedRelation: "change_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exposures_linked_claim_id_fkey"
            columns: ["linked_claim_id"]
            isOneToOne: false
            referencedRelation: "project_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exposures_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_certificates: {
        Row: {
          auto_limit: number
          carrier: string
          created_at: string
          effective_date: string | null
          expiry_date: string | null
          file_name: string
          gl_limit: number
          id: string
          notes: string
          other_coverage: string
          project_id: string
          storage_path: string
          subcontract_id: string
          umbrella_limit: number
          updated_at: string
          uploaded_by: string | null
          verified: boolean
          wc_limit: number
        }
        Insert: {
          auto_limit?: number
          carrier?: string
          created_at?: string
          effective_date?: string | null
          expiry_date?: string | null
          file_name?: string
          gl_limit?: number
          id?: string
          notes?: string
          other_coverage?: string
          project_id: string
          storage_path?: string
          subcontract_id: string
          umbrella_limit?: number
          updated_at?: string
          uploaded_by?: string | null
          verified?: boolean
          wc_limit?: number
        }
        Update: {
          auto_limit?: number
          carrier?: string
          created_at?: string
          effective_date?: string | null
          expiry_date?: string | null
          file_name?: string
          gl_limit?: number
          id?: string
          notes?: string
          other_coverage?: string
          project_id?: string
          storage_path?: string
          subcontract_id?: string
          umbrella_limit?: number
          updated_at?: string
          uploaded_by?: string | null
          verified?: boolean
          wc_limit?: number
        }
        Relationships: [
          {
            foreignKeyName: "insurance_certificates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_certificates_subcontract_id_fkey"
            columns: ["subcontract_id"]
            isOneToOne: false
            referencedRelation: "subcontracts"
            referencedColumns: ["id"]
          },
        ]
      }
      lien_waivers: {
        Row: {
          amount: number
          created_at: string
          file_name: string
          id: string
          notes: string
          payment_id: string | null
          project_id: string
          signed_date: string | null
          storage_path: string
          subcontract_id: string
          through_date: string | null
          uploaded_by: string | null
          waiver_type: string
        }
        Insert: {
          amount?: number
          created_at?: string
          file_name?: string
          id?: string
          notes?: string
          payment_id?: string | null
          project_id: string
          signed_date?: string | null
          storage_path?: string
          subcontract_id: string
          through_date?: string | null
          uploaded_by?: string | null
          waiver_type?: string
        }
        Update: {
          amount?: number
          created_at?: string
          file_name?: string
          id?: string
          notes?: string
          payment_id?: string | null
          project_id?: string
          signed_date?: string | null
          storage_path?: string
          subcontract_id?: string
          through_date?: string | null
          uploaded_by?: string | null
          waiver_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "lien_waivers_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "subcontract_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lien_waivers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lien_waivers_subcontract_id_fkey"
            columns: ["subcontract_id"]
            isOneToOne: false
            referencedRelation: "subcontracts"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string
          created_at: string
          data: Json
          dedupe_key: string | null
          entity_id: string | null
          entity_type: string
          id: string
          organization_id: string | null
          project_id: string | null
          read_at: string | null
          recipient_id: string
          title: string
          type: string
          url: string
        }
        Insert: {
          actor_id?: string | null
          body?: string
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          organization_id?: string | null
          project_id?: string | null
          read_at?: string | null
          recipient_id: string
          title?: string
          type: string
          url?: string
        }
        Update: {
          actor_id?: string | null
          body?: string
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          organization_id?: string | null
          project_id?: string | null
          read_at?: string | null
          recipient_id?: string
          title?: string
          type?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
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
          capabilities: Json
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
          capabilities?: Json
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
          capabilities?: Json
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
          capabilities: Json
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
          capabilities?: Json
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
          capabilities?: Json
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
      organization_payment_profiles: {
        Row: {
          account_number: string
          bank_name: string
          card_fee_pass_through: boolean
          collections_overdue_days: number
          created_at: string
          created_by: string | null
          default_payment_methods: Json
          id: string
          organization_id: string
          remittance_memo_template: string
          routing_number: string
          stripe_amount_threshold_cents: number
          updated_at: string
          wire_instructions: string
        }
        Insert: {
          account_number?: string
          bank_name?: string
          card_fee_pass_through?: boolean
          collections_overdue_days?: number
          created_at?: string
          created_by?: string | null
          default_payment_methods?: Json
          id?: string
          organization_id: string
          remittance_memo_template?: string
          routing_number?: string
          stripe_amount_threshold_cents?: number
          updated_at?: string
          wire_instructions?: string
        }
        Update: {
          account_number?: string
          bank_name?: string
          card_fee_pass_through?: boolean
          collections_overdue_days?: number
          created_at?: string
          created_by?: string | null
          default_payment_methods?: Json
          id?: string
          organization_id?: string
          remittance_memo_template?: string
          routing_number?: string
          stripe_amount_threshold_cents?: number
          updated_at?: string
          wire_instructions?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_payment_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address_line1: string
          address_line2: string
          billing_contact_name: string
          billing_email: string
          billing_grace_ends_at: string | null
          billing_status: string
          circle_entitlement_checked_at: string | null
          circle_entitlement_member_email: string
          circle_entitlement_tier: string
          city: string
          contractor_circle_grant: boolean
          country: string
          created_at: string
          created_by: string | null
          daily_report_limit_per_month: number
          entitlement_expires_at: string | null
          entitlement_source: string
          id: string
          legal_name: string
          license_number: string
          logo_path: string
          logo_url: string
          name: string
          office_phone: string
          payment_processor_ready: boolean
          plan_code: string
          postal_code: string
          project_limit: number
          seat_limit: number
          slug: string
          state: string
          storage_limit_mb: number
          stripe_checkout_session_id: string
          stripe_connect_account_id: string
          stripe_connect_account_id_live: string
          stripe_connect_account_id_test: string
          stripe_connect_status: string
          stripe_connect_status_live: string
          stripe_connect_status_test: string
          stripe_customer_id: string
          stripe_mode: Database["public"]["Enums"]["stripe_mode"]
          stripe_payment_limit_cents: number
          stripe_price_id: string
          stripe_subscription_id: string
          subscription_cancel_at_period_end: boolean
          subscription_current_period_end: string | null
          tax_identifier: string
          trial_ends_at: string | null
          updated_at: string
          website_url: string
        }
        Insert: {
          address_line1?: string
          address_line2?: string
          billing_contact_name?: string
          billing_email?: string
          billing_grace_ends_at?: string | null
          billing_status?: string
          circle_entitlement_checked_at?: string | null
          circle_entitlement_member_email?: string
          circle_entitlement_tier?: string
          city?: string
          contractor_circle_grant?: boolean
          country?: string
          created_at?: string
          created_by?: string | null
          daily_report_limit_per_month?: number
          entitlement_expires_at?: string | null
          entitlement_source?: string
          id?: string
          legal_name?: string
          license_number?: string
          logo_path?: string
          logo_url?: string
          name: string
          office_phone?: string
          payment_processor_ready?: boolean
          plan_code?: string
          postal_code?: string
          project_limit?: number
          seat_limit?: number
          slug?: string
          state?: string
          storage_limit_mb?: number
          stripe_checkout_session_id?: string
          stripe_connect_account_id?: string
          stripe_connect_account_id_live?: string
          stripe_connect_account_id_test?: string
          stripe_connect_status?: string
          stripe_connect_status_live?: string
          stripe_connect_status_test?: string
          stripe_customer_id?: string
          stripe_mode?: Database["public"]["Enums"]["stripe_mode"]
          stripe_payment_limit_cents?: number
          stripe_price_id?: string
          stripe_subscription_id?: string
          subscription_cancel_at_period_end?: boolean
          subscription_current_period_end?: string | null
          tax_identifier?: string
          trial_ends_at?: string | null
          updated_at?: string
          website_url?: string
        }
        Update: {
          address_line1?: string
          address_line2?: string
          billing_contact_name?: string
          billing_email?: string
          billing_grace_ends_at?: string | null
          billing_status?: string
          circle_entitlement_checked_at?: string | null
          circle_entitlement_member_email?: string
          circle_entitlement_tier?: string
          city?: string
          contractor_circle_grant?: boolean
          country?: string
          created_at?: string
          created_by?: string | null
          daily_report_limit_per_month?: number
          entitlement_expires_at?: string | null
          entitlement_source?: string
          id?: string
          legal_name?: string
          license_number?: string
          logo_path?: string
          logo_url?: string
          name?: string
          office_phone?: string
          payment_processor_ready?: boolean
          plan_code?: string
          postal_code?: string
          project_limit?: number
          seat_limit?: number
          slug?: string
          state?: string
          storage_limit_mb?: number
          stripe_checkout_session_id?: string
          stripe_connect_account_id?: string
          stripe_connect_account_id_live?: string
          stripe_connect_account_id_test?: string
          stripe_connect_status?: string
          stripe_connect_status_live?: string
          stripe_connect_status_test?: string
          stripe_customer_id?: string
          stripe_mode?: Database["public"]["Enums"]["stripe_mode"]
          stripe_payment_limit_cents?: number
          stripe_price_id?: string
          stripe_subscription_id?: string
          subscription_cancel_at_period_end?: boolean
          subscription_current_period_end?: string | null
          tax_identifier?: string
          trial_ends_at?: string | null
          updated_at?: string
          website_url?: string
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
          amount_cents: number
          billing_application_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          gross_received: number
          gross_received_cents: number
          id: string
          idempotency_key: string | null
          invoice_id: string
          net_payout: number
          net_payout_cents: number
          notes: string
          organization_id: string | null
          overwatch_fee: number
          overwatch_fee_cents: number
          paid_at: string
          payment_method: string
          processor: string
          processor_fee: number
          processor_fee_cents: number
          processor_fee_observed_at: string | null
          processor_fee_source: string
          processor_payment_id: string
          project_id: string
          receipt_url: string
          reference: string
          refunded_amount_cents: number
          refunded_gross_cents: number
          refunded_surcharge_cents: number
          status: string
          stripe_balance_transaction_id: string
          stripe_charge_id: string
          stripe_checkout_session_id: string
          stripe_payment_intent_id: string
          surcharge: number
          surcharge_cents: number
          updated_at: string
        }
        Insert: {
          amount?: number
          amount_cents?: number
          billing_application_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          gross_received?: number
          gross_received_cents?: number
          id?: string
          idempotency_key?: string | null
          invoice_id: string
          net_payout?: number
          net_payout_cents?: number
          notes?: string
          organization_id?: string | null
          overwatch_fee?: number
          overwatch_fee_cents?: number
          paid_at?: string
          payment_method?: string
          processor?: string
          processor_fee?: number
          processor_fee_cents?: number
          processor_fee_observed_at?: string | null
          processor_fee_source?: string
          processor_payment_id?: string
          project_id: string
          receipt_url?: string
          reference?: string
          refunded_amount_cents?: number
          refunded_gross_cents?: number
          refunded_surcharge_cents?: number
          status?: string
          stripe_balance_transaction_id?: string
          stripe_charge_id?: string
          stripe_checkout_session_id?: string
          stripe_payment_intent_id?: string
          surcharge?: number
          surcharge_cents?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_cents?: number
          billing_application_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          gross_received?: number
          gross_received_cents?: number
          id?: string
          idempotency_key?: string | null
          invoice_id?: string
          net_payout?: number
          net_payout_cents?: number
          notes?: string
          organization_id?: string | null
          overwatch_fee?: number
          overwatch_fee_cents?: number
          paid_at?: string
          payment_method?: string
          processor?: string
          processor_fee?: number
          processor_fee_cents?: number
          processor_fee_observed_at?: string | null
          processor_fee_source?: string
          processor_payment_id?: string
          project_id?: string
          receipt_url?: string
          reference?: string
          refunded_amount_cents?: number
          refunded_gross_cents?: number
          refunded_surcharge_cents?: number
          status?: string
          stripe_balance_transaction_id?: string
          stripe_charge_id?: string
          stripe_checkout_session_id?: string
          stripe_payment_intent_id?: string
          surcharge?: number
          surcharge_cents?: number
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
            foreignKeyName: "payment_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      payment_refund_events: {
        Row: {
          billing_application_id: string | null
          created_at: string
          created_by: string | null
          cumulative_refunded_gross_cents: number
          id: string
          idempotency_key: string
          invoice_id: string
          notes: string
          organization_id: string | null
          payment_id: string
          processor: string
          processor_event_id: string
          project_id: string
          receipt_url: string
          refund_amount_cents: number
          refund_gross_cents: number
          refund_surcharge_cents: number
          request_fingerprint: string
          stripe_charge_id: string
        }
        Insert: {
          billing_application_id?: string | null
          created_at?: string
          created_by?: string | null
          cumulative_refunded_gross_cents: number
          id?: string
          idempotency_key: string
          invoice_id: string
          notes?: string
          organization_id?: string | null
          payment_id: string
          processor: string
          processor_event_id?: string
          project_id: string
          receipt_url?: string
          refund_amount_cents: number
          refund_gross_cents: number
          refund_surcharge_cents: number
          request_fingerprint?: string
          stripe_charge_id?: string
        }
        Update: {
          billing_application_id?: string | null
          created_at?: string
          created_by?: string | null
          cumulative_refunded_gross_cents?: number
          id?: string
          idempotency_key?: string
          invoice_id?: string
          notes?: string
          organization_id?: string | null
          payment_id?: string
          processor?: string
          processor_event_id?: string
          project_id?: string
          receipt_url?: string
          refund_amount_cents?: number
          refund_gross_cents?: number
          refund_surcharge_cents?: number
          request_fingerprint?: string
          stripe_charge_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_refund_events_billing_application_id_fkey"
            columns: ["billing_application_id"]
            isOneToOne: false
            referencedRelation: "billing_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refund_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refund_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refund_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_rollup_backfill_evidence: {
        Row: {
          before_state: Json
          created_at: string
          id: string
          migration_key: string
          project_id: string | null
          record_id: string
          record_kind: string
        }
        Insert: {
          before_state: Json
          created_at?: string
          id?: string
          migration_key: string
          project_id?: string | null
          record_id: string
          record_kind: string
        }
        Update: {
          before_state?: Json
          created_at?: string
          id?: string
          migration_key?: string
          project_id?: string | null
          record_id?: string
          record_kind?: string
        }
        Relationships: []
      }
      pipeline_accounts: {
        Row: {
          account_type: string
          address: string
          archived: boolean
          created_at: string
          created_by: string | null
          email: string
          id: string
          last_touch_at: string | null
          market_sector: string
          name: string
          next_touch_at: string | null
          notes: string
          organization_id: string
          owner_name: string
          phone: string
          relationship_health: string
          relationship_stage: string
          source: string
          updated_at: string
          website: string
        }
        Insert: {
          account_type?: string
          address?: string
          archived?: boolean
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          last_touch_at?: string | null
          market_sector?: string
          name: string
          next_touch_at?: string | null
          notes?: string
          organization_id: string
          owner_name?: string
          phone?: string
          relationship_health?: string
          relationship_stage?: string
          source?: string
          updated_at?: string
          website?: string
        }
        Update: {
          account_type?: string
          address?: string
          archived?: boolean
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          last_touch_at?: string | null
          market_sector?: string
          name?: string
          next_touch_at?: string | null
          notes?: string
          organization_id?: string
          owner_name?: string
          phone?: string
          relationship_health?: string
          relationship_stage?: string
          source?: string
          updated_at?: string
          website?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_activity_log: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: string
          from_value: string
          id: string
          notes: string
          opportunity_id: string
          organization_id: string
          to_value: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: string
          from_value?: string
          id?: string
          notes?: string
          opportunity_id: string
          organization_id: string
          to_value?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: string
          from_value?: string
          id?: string
          notes?: string
          opportunity_id?: string
          organization_id?: string
          to_value?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_activity_log_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "pipeline_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_activity_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_contacts: {
        Row: {
          account_id: string | null
          archived: boolean
          created_at: string
          created_by: string | null
          email: string
          id: string
          influence_level: string
          last_touch_at: string | null
          name: string
          notes: string
          organization_id: string
          phone: string
          relationship_status: string
          role: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          archived?: boolean
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          influence_level?: string
          last_touch_at?: string | null
          name: string
          notes?: string
          organization_id: string
          phone?: string
          relationship_status?: string
          role?: string
          title?: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          archived?: boolean
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          influence_level?: string
          last_touch_at?: string | null
          name?: string
          notes?: string
          organization_id?: string
          phone?: string
          relationship_status?: string
          role?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "pipeline_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_next_actions: {
        Row: {
          account_id: string | null
          action_type: string
          body: string
          completed_at: string | null
          completed_by: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          notes: string
          opportunity_id: string | null
          organization_id: string
          outcome: string
          outcome_notes: string
          owner_name: string
          owner_user_id: string | null
          playbook_enrollment_id: string | null
          playbook_step_id: string | null
          priority: string
          sent_at: string | null
          sent_message_id: string
          skipped_at: string | null
          skipped_by: string | null
          subject: string
          title: string
          updated_at: string
          value_angle: string
          value_asset_id: string | null
        }
        Insert: {
          account_id?: string | null
          action_type?: string
          body?: string
          completed_at?: string | null
          completed_by?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          notes?: string
          opportunity_id?: string | null
          organization_id: string
          outcome?: string
          outcome_notes?: string
          owner_name?: string
          owner_user_id?: string | null
          playbook_enrollment_id?: string | null
          playbook_step_id?: string | null
          priority?: string
          sent_at?: string | null
          sent_message_id?: string
          skipped_at?: string | null
          skipped_by?: string | null
          subject?: string
          title: string
          updated_at?: string
          value_angle?: string
          value_asset_id?: string | null
        }
        Update: {
          account_id?: string | null
          action_type?: string
          body?: string
          completed_at?: string | null
          completed_by?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          notes?: string
          opportunity_id?: string | null
          organization_id?: string
          outcome?: string
          outcome_notes?: string
          owner_name?: string
          owner_user_id?: string | null
          playbook_enrollment_id?: string | null
          playbook_step_id?: string | null
          priority?: string
          sent_at?: string | null
          sent_message_id?: string
          skipped_at?: string | null
          skipped_by?: string | null
          subject?: string
          title?: string
          updated_at?: string
          value_angle?: string
          value_asset_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "pipeline_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_next_actions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "pipeline_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_next_actions_followup_enrollment_fk"
            columns: ["playbook_enrollment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "crm_followup_enrollments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pipeline_next_actions_followup_step_fk"
            columns: ["playbook_step_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "crm_followup_playbook_steps"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pipeline_next_actions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "pipeline_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_next_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_next_actions_value_asset_fk"
            columns: ["value_asset_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "crm_value_assets"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      pipeline_opportunities: {
        Row: {
          account_id: string | null
          archived: boolean
          assigned_to: string
          bid_decision: string
          bid_decision_date: string | null
          bid_decision_reason: string
          bid_due_date: string | null
          client: string
          client_contact_email: string
          client_contact_name: string
          client_contact_phone: string
          converted_at: string | null
          converted_project_id: string | null
          created_at: string
          created_by: string | null
          decision_date: string | null
          estimated_contract: number
          estimated_cost: number
          estimated_gp_pct: number | null
          id: string
          last_activity_at: string
          name: string
          notes: string
          organization_id: string
          primary_contact_id: string | null
          probability: number
          project_type: string
          scope_summary: string
          source: string
          stage: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          archived?: boolean
          assigned_to?: string
          bid_decision?: string
          bid_decision_date?: string | null
          bid_decision_reason?: string
          bid_due_date?: string | null
          client?: string
          client_contact_email?: string
          client_contact_name?: string
          client_contact_phone?: string
          converted_at?: string | null
          converted_project_id?: string | null
          created_at?: string
          created_by?: string | null
          decision_date?: string | null
          estimated_contract?: number
          estimated_cost?: number
          estimated_gp_pct?: number | null
          id?: string
          last_activity_at?: string
          name: string
          notes?: string
          organization_id: string
          primary_contact_id?: string | null
          probability?: number
          project_type?: string
          scope_summary?: string
          source?: string
          stage?: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          archived?: boolean
          assigned_to?: string
          bid_decision?: string
          bid_decision_date?: string | null
          bid_decision_reason?: string
          bid_due_date?: string | null
          client?: string
          client_contact_email?: string
          client_contact_name?: string
          client_contact_phone?: string
          converted_at?: string | null
          converted_project_id?: string | null
          created_at?: string
          created_by?: string | null
          decision_date?: string | null
          estimated_contract?: number
          estimated_cost?: number
          estimated_gp_pct?: number | null
          id?: string
          last_activity_at?: string
          name?: string
          notes?: string
          organization_id?: string
          primary_contact_id?: string | null
          probability?: number
          project_type?: string
          scope_summary?: string
          source?: string
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_opportunities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "pipeline_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_opportunities_converted_project_id_fkey"
            columns: ["converted_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_opportunities_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "pipeline_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      production_sov_billing_handoffs: {
        Row: {
          application_number_snapshot: string
          applied_at: string
          applied_by: string
          applied_total_completed_and_stored_cents: number
          applied_work_this_period_cents: number
          billing_application_id: string | null
          billing_line_item_id: string | null
          certified_percent: number
          contract_value_cents: number
          cost_bucket_id: string
          cost_code_snapshot: string
          description_snapshot: string
          id: string
          prior_completed_and_stored_cents: number
          prior_draft_work_cents: number
          production_sov_certification_id: string
          project_id: string
          retained_draft_materials_cents: number
        }
        Insert: {
          application_number_snapshot?: string
          applied_at?: string
          applied_by?: string
          applied_total_completed_and_stored_cents: number
          applied_work_this_period_cents: number
          billing_application_id?: string | null
          billing_line_item_id?: string | null
          certified_percent: number
          contract_value_cents: number
          cost_bucket_id: string
          cost_code_snapshot?: string
          description_snapshot?: string
          id?: string
          prior_completed_and_stored_cents: number
          prior_draft_work_cents: number
          production_sov_certification_id: string
          project_id: string
          retained_draft_materials_cents: number
        }
        Update: {
          application_number_snapshot?: string
          applied_at?: string
          applied_by?: string
          applied_total_completed_and_stored_cents?: number
          applied_work_this_period_cents?: number
          billing_application_id?: string | null
          billing_line_item_id?: string | null
          certified_percent?: number
          contract_value_cents?: number
          cost_bucket_id?: string
          cost_code_snapshot?: string
          description_snapshot?: string
          id?: string
          prior_completed_and_stored_cents?: number
          prior_draft_work_cents?: number
          production_sov_certification_id?: string
          project_id?: string
          retained_draft_materials_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_sov_billing_handof_production_sov_certification_fkey"
            columns: ["production_sov_certification_id"]
            isOneToOne: true
            referencedRelation: "production_sov_certifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_sov_billing_handoffs_billing_application_id_fkey"
            columns: ["billing_application_id"]
            isOneToOne: false
            referencedRelation: "billing_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_sov_billing_handoffs_billing_line_item_id_fkey"
            columns: ["billing_line_item_id"]
            isOneToOne: false
            referencedRelation: "billing_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_sov_billing_handoffs_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_sov_billing_handoffs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      production_sov_certification_invalidations: {
        Row: {
          id: string
          invalidated_at: string
          invalidated_by: string | null
          production_sov_certification_id: string
          project_id: string
          reason_code: string
          reason_detail: string
        }
        Insert: {
          id?: string
          invalidated_at?: string
          invalidated_by?: string | null
          production_sov_certification_id: string
          project_id: string
          reason_code: string
          reason_detail?: string
        }
        Update: {
          id?: string
          invalidated_at?: string
          invalidated_by?: string | null
          production_sov_certification_id?: string
          project_id?: string
          reason_code?: string
          reason_detail?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_sov_certification__production_sov_certification_fkey"
            columns: ["production_sov_certification_id"]
            isOneToOne: true
            referencedRelation: "production_sov_certifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_sov_certification_invalidations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      production_sov_certifications: {
        Row: {
          calculation_version: string
          certification_note: string
          certified_at: string
          certified_by: string
          certified_percent: number
          cost_bucket_id: string
          current_sov_percent: number
          id: string
          installed_quantity: number | null
          planned_quantity: number | null
          project_id: string
          recent_daily_pace: number | null
          recommended_percent: number
          required_daily_pace: number | null
          source_period_end: string
          source_period_start: string
          source_wip_entry_id: string | null
          source_wip_review_version: number | null
          source_wip_reviewed_at: string | null
          source_wip_updated_at: string | null
          target_date: string | null
          unit: string | null
        }
        Insert: {
          calculation_version?: string
          certification_note?: string
          certified_at?: string
          certified_by?: string
          certified_percent: number
          cost_bucket_id: string
          current_sov_percent: number
          id?: string
          installed_quantity?: number | null
          planned_quantity?: number | null
          project_id: string
          recent_daily_pace?: number | null
          recommended_percent: number
          required_daily_pace?: number | null
          source_period_end: string
          source_period_start: string
          source_wip_entry_id?: string | null
          source_wip_review_version?: number | null
          source_wip_reviewed_at?: string | null
          source_wip_updated_at?: string | null
          target_date?: string | null
          unit?: string | null
        }
        Update: {
          calculation_version?: string
          certification_note?: string
          certified_at?: string
          certified_by?: string
          certified_percent?: number
          cost_bucket_id?: string
          current_sov_percent?: number
          id?: string
          installed_quantity?: number | null
          planned_quantity?: number | null
          project_id?: string
          recent_daily_pace?: number | null
          recommended_percent?: number
          required_daily_pace?: number | null
          source_period_end?: string
          source_period_start?: string
          source_wip_entry_id?: string | null
          source_wip_review_version?: number | null
          source_wip_reviewed_at?: string | null
          source_wip_updated_at?: string | null
          target_date?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_sov_certifications_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_sov_certifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_sov_certifications_source_wip_entry_id_fkey"
            columns: ["source_wip_entry_id"]
            isOneToOne: false
            referencedRelation: "daily_wip_entries"
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
          notification_prefs: Json
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
          notification_prefs?: Json
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
          notification_prefs?: Json
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
      project_claim_documents: {
        Row: {
          claim_id: string
          created_at: string
          created_by: string | null
          doc_type: string
          file_name: string
          id: string
          note: string
          project_id: string
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          created_by?: string | null
          doc_type?: string
          file_name?: string
          id?: string
          note?: string
          project_id: string
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          created_by?: string | null
          doc_type?: string
          file_name?: string
          id?: string
          note?: string
          project_id?: string
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_claim_documents_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "project_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_claim_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_claim_events: {
        Row: {
          claim_id: string
          created_at: string
          created_by: string | null
          event_date: string | null
          event_type: string
          id: string
          note: string
          project_id: string
          revision_number: number
          seed_key: string
          updated_at: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          created_by?: string | null
          event_date?: string | null
          event_type?: string
          id?: string
          note?: string
          project_id: string
          revision_number?: number
          seed_key?: string
          updated_at?: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          created_by?: string | null
          event_date?: string | null
          event_type?: string
          id?: string
          note?: string
          project_id?: string
          revision_number?: number
          seed_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_claim_events_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "project_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_claim_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_claims: {
        Row: {
          change_order_id: string | null
          claim_number: string
          claim_type: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          money_awarded: number
          money_claimed: number
          outcome: string
          owner: string
          project_id: string
          resolved_at: string | null
          risk_exposure_id: string | null
          seed_key: string
          status: string
          submitted_at: string | null
          time_awarded_days: number
          time_claimed_days: number
          title: string
          updated_at: string
        }
        Insert: {
          change_order_id?: string | null
          claim_number?: string
          claim_type?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          money_awarded?: number
          money_claimed?: number
          outcome?: string
          owner?: string
          project_id: string
          resolved_at?: string | null
          risk_exposure_id?: string | null
          seed_key?: string
          status?: string
          submitted_at?: string | null
          time_awarded_days?: number
          time_claimed_days?: number
          title?: string
          updated_at?: string
        }
        Update: {
          change_order_id?: string | null
          claim_number?: string
          claim_type?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          money_awarded?: number
          money_claimed?: number
          outcome?: string
          owner?: string
          project_id?: string
          resolved_at?: string | null
          risk_exposure_id?: string | null
          seed_key?: string
          status?: string
          submitted_at?: string | null
          time_awarded_days?: number
          time_claimed_days?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_claims_change_order_id_fkey"
            columns: ["change_order_id"]
            isOneToOne: false
            referencedRelation: "change_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_claims_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_claims_risk_exposure_id_fkey"
            columns: ["risk_exposure_id"]
            isOneToOne: false
            referencedRelation: "exposures"
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
          can_view_selections: boolean
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
          can_view_selections?: boolean
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
          can_view_selections?: boolean
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
      project_documents: {
        Row: {
          archived_at: string | null
          category: string
          content_type: string
          created_at: string
          description: string
          file_name: string
          id: string
          project_id: string
          size_bytes: number
          storage_path: string
          title: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          archived_at?: string | null
          category?: string
          content_type?: string
          created_at?: string
          description?: string
          file_name?: string
          id?: string
          project_id: string
          size_bytes?: number
          storage_path: string
          title?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          archived_at?: string | null
          category?: string
          content_type?: string
          created_at?: string
          description?: string
          file_name?: string
          id?: string
          project_id?: string
          size_bytes?: number
          storage_path?: string
          title?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_financial_operations: {
        Row: {
          changed_by: string
          created_at: string
          id: string
          operation_key: string
          operation_type: string
          project_id: string
          request_fingerprint: string
          result: Json
        }
        Insert: {
          changed_by: string
          created_at?: string
          id?: string
          operation_key: string
          operation_type: string
          project_id: string
          request_fingerprint: string
          result?: Json
        }
        Update: {
          changed_by?: string
          created_at?: string
          id?: string
          operation_key?: string
          operation_type?: string
          project_id?: string
          request_fingerprint?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "project_financial_operations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_financial_overrides: {
        Row: {
          changed_by: string
          created_at: string
          field: string
          id: string
          new_value: Json | null
          old_value: Json | null
          operation_key: string
          project_id: string
          reason: string
        }
        Insert: {
          changed_by: string
          created_at?: string
          field: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          operation_key: string
          project_id: string
          reason: string
        }
        Update: {
          changed_by?: string
          created_at?: string
          field?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          operation_key?: string
          project_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_financial_overrides_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_inspections: {
        Row: {
          attempt_number: number
          authority: string
          completed_date: string | null
          corrective_action: string
          cost_impact: number
          created_at: string
          created_by: string | null
          id: string
          inspection_type: string
          inspector: string
          location: string
          notes: string
          parent_inspection_id: string | null
          project_id: string
          requested_date: string | null
          required_reinspection: boolean
          responsible_party: string
          result: string
          risk_exposure_id: string | null
          schedule_impact_weeks: number | null
          scheduled_date: string | null
          seed_key: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_number?: number
          authority?: string
          completed_date?: string | null
          corrective_action?: string
          cost_impact?: number
          created_at?: string
          created_by?: string | null
          id?: string
          inspection_type?: string
          inspector?: string
          location?: string
          notes?: string
          parent_inspection_id?: string | null
          project_id: string
          requested_date?: string | null
          required_reinspection?: boolean
          responsible_party?: string
          result?: string
          risk_exposure_id?: string | null
          schedule_impact_weeks?: number | null
          scheduled_date?: string | null
          seed_key?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_number?: number
          authority?: string
          completed_date?: string | null
          corrective_action?: string
          cost_impact?: number
          created_at?: string
          created_by?: string | null
          id?: string
          inspection_type?: string
          inspector?: string
          location?: string
          notes?: string
          parent_inspection_id?: string | null
          project_id?: string
          requested_date?: string | null
          required_reinspection?: boolean
          responsible_party?: string
          result?: string
          risk_exposure_id?: string | null
          schedule_impact_weeks?: number | null
          scheduled_date?: string | null
          seed_key?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_inspections_parent_inspection_id_fkey"
            columns: ["parent_inspection_id"]
            isOneToOne: false
            referencedRelation: "project_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_inspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_inspections_risk_exposure_id_fkey"
            columns: ["risk_exposure_id"]
            isOneToOne: false
            referencedRelation: "exposures"
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
      project_selection_decisions: {
        Row: {
          client_email: string
          client_user_id: string | null
          contact_id: string | null
          created_at: string
          decision: string
          id: string
          notes: string
          option_id: string | null
          option_snapshot: Json | null
          project_id: string
          selection_id: string
          selection_snapshot: Json
          selection_version: number
          user_agent: string
        }
        Insert: {
          client_email?: string
          client_user_id?: string | null
          contact_id?: string | null
          created_at?: string
          decision: string
          id?: string
          notes?: string
          option_id?: string | null
          option_snapshot?: Json | null
          project_id: string
          selection_id: string
          selection_snapshot?: Json
          selection_version: number
          user_agent?: string
        }
        Update: {
          client_email?: string
          client_user_id?: string | null
          contact_id?: string | null
          created_at?: string
          decision?: string
          id?: string
          notes?: string
          option_id?: string | null
          option_snapshot?: Json | null
          project_id?: string
          selection_id?: string
          selection_snapshot?: Json
          selection_version?: number
          user_agent?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_selection_decisions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_selection_decisions_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "project_selection_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_selection_decisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_selection_decisions_selection_id_fkey"
            columns: ["selection_id"]
            isOneToOne: false
            referencedRelation: "project_selections"
            referencedColumns: ["id"]
          },
        ]
      }
      project_selection_options: {
        Row: {
          created_at: string
          description: string
          finish: string
          id: string
          is_recommended: boolean
          manufacturer: string
          model_number: string
          price_cents: number
          project_id: string
          selection_id: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          finish?: string
          id?: string
          is_recommended?: boolean
          manufacturer?: string
          model_number?: string
          price_cents?: number
          project_id: string
          selection_id: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          finish?: string
          id?: string
          is_recommended?: boolean
          manufacturer?: string
          model_number?: string
          price_cents?: number
          project_id?: string
          selection_id?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_selection_options_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_selection_options_selection_id_fkey"
            columns: ["selection_id"]
            isOneToOne: false
            referencedRelation: "project_selections"
            referencedColumns: ["id"]
          },
        ]
      }
      project_selections: {
        Row: {
          allowance_cents: number
          approval_gate_entry_id: string | null
          approval_gate_overridden_at: string | null
          approval_gate_overridden_by: string | null
          approval_gate_override_acknowledged: boolean
          approval_gate_override_reason: string
          approval_gate_type: string
          approved_at: string | null
          approving_party: string
          assigned_client_contact_id: string | null
          category: string
          client_decided_at: string | null
          client_decision_due_date: string | null
          client_review_days: number
          client_sent_at: string | null
          client_visible: boolean
          created_at: string
          created_by: string | null
          decision_status: string
          delivery_buffer_days: number
          description: string
          follow_on_approval_due_date: string | null
          follow_on_approval_gate_entry_id: string | null
          id: string
          need_on_site_date: string | null
          order_by_date: string | null
          procurement_lead_days: number
          procurement_status: string
          project_id: string
          responsible_party: string
          rfi_outcome: string | null
          rfi_response_days: number
          room_area: string
          schedule_activity_id: string | null
          schedule_override_acknowledged: boolean
          selected_option_id: string | null
          selection_number: string
          spec_section: string
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          allowance_cents?: number
          approval_gate_entry_id?: string | null
          approval_gate_overridden_at?: string | null
          approval_gate_overridden_by?: string | null
          approval_gate_override_acknowledged?: boolean
          approval_gate_override_reason?: string
          approval_gate_type?: string
          approved_at?: string | null
          approving_party?: string
          assigned_client_contact_id?: string | null
          category?: string
          client_decided_at?: string | null
          client_decision_due_date?: string | null
          client_review_days?: number
          client_sent_at?: string | null
          client_visible?: boolean
          created_at?: string
          created_by?: string | null
          decision_status?: string
          delivery_buffer_days?: number
          description?: string
          follow_on_approval_due_date?: string | null
          follow_on_approval_gate_entry_id?: string | null
          id?: string
          need_on_site_date?: string | null
          order_by_date?: string | null
          procurement_lead_days?: number
          procurement_status?: string
          project_id: string
          responsible_party?: string
          rfi_outcome?: string | null
          rfi_response_days?: number
          room_area?: string
          schedule_activity_id?: string | null
          schedule_override_acknowledged?: boolean
          selected_option_id?: string | null
          selection_number?: string
          spec_section?: string
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          allowance_cents?: number
          approval_gate_entry_id?: string | null
          approval_gate_overridden_at?: string | null
          approval_gate_overridden_by?: string | null
          approval_gate_override_acknowledged?: boolean
          approval_gate_override_reason?: string
          approval_gate_type?: string
          approved_at?: string | null
          approving_party?: string
          assigned_client_contact_id?: string | null
          category?: string
          client_decided_at?: string | null
          client_decision_due_date?: string | null
          client_review_days?: number
          client_sent_at?: string | null
          client_visible?: boolean
          created_at?: string
          created_by?: string | null
          decision_status?: string
          delivery_buffer_days?: number
          description?: string
          follow_on_approval_due_date?: string | null
          follow_on_approval_gate_entry_id?: string | null
          id?: string
          need_on_site_date?: string | null
          order_by_date?: string | null
          procurement_lead_days?: number
          procurement_status?: string
          project_id?: string
          responsible_party?: string
          rfi_outcome?: string | null
          rfi_response_days?: number
          room_area?: string
          schedule_activity_id?: string | null
          schedule_override_acknowledged?: boolean
          selected_option_id?: string | null
          selection_number?: string
          spec_section?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_selections_approval_gate_entry_id_fkey"
            columns: ["approval_gate_entry_id"]
            isOneToOne: false
            referencedRelation: "submittal_log_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_selections_assigned_client_contact_id_fkey"
            columns: ["assigned_client_contact_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_selections_follow_on_gate_entry_id_fkey"
            columns: ["follow_on_approval_gate_entry_id"]
            isOneToOne: false
            referencedRelation: "submittal_log_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_selections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_selections_schedule_activity_id_fkey"
            columns: ["schedule_activity_id"]
            isOneToOne: false
            referencedRelation: "schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_selections_selected_option_id_fkey"
            columns: ["selected_option_id"]
            isOneToOne: false
            referencedRelation: "project_selection_options"
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
          budget_locked_at: string | null
          client: string
          closed_at: string | null
          created_at: string
          default_output_format: string
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
          require_compliance_gating: boolean
          schedule_variance_weeks: number
          source_opportunity_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          baseline_completion_date?: string | null
          billing_contact_email?: string
          billing_contact_name?: string
          billing_frequency?: string
          budget_locked_at?: string | null
          client?: string
          closed_at?: string | null
          created_at?: string
          default_output_format?: string
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
          require_compliance_gating?: boolean
          schedule_variance_weeks?: number
          source_opportunity_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          baseline_completion_date?: string | null
          billing_contact_email?: string
          billing_contact_name?: string
          billing_frequency?: string
          budget_locked_at?: string | null
          client?: string
          closed_at?: string | null
          created_at?: string
          default_output_format?: string
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
          require_compliance_gating?: boolean
          schedule_variance_weeks?: number
          source_opportunity_id?: string | null
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
          {
            foreignKeyName: "projects_source_opportunity_id_fkey"
            columns: ["source_opportunity_id"]
            isOneToOne: false
            referencedRelation: "pipeline_opportunities"
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
          last_sent_at: string | null
          pdf_path: string
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
          last_sent_at?: string | null
          pdf_path?: string
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
          last_sent_at?: string | null
          pdf_path?: string
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
          actual_finish_date: string | null
          actual_start_date: string | null
          baseline_finish_date: string | null
          baseline_start_date: string | null
          created_at: string
          division: string
          finish_date: string | null
          forecast_finish_date: string | null
          forecast_start_date: string | null
          id: string
          name: string
          notes: string
          percent_complete: number
          predecessor_activity_ids: string[]
          project_id: string
          remaining_duration_days: number | null
          sort_order: number
          start_date: string | null
          successor_activity_ids: string[]
          updated_at: string
          wbs_section_id: string | null
        }
        Insert: {
          activity_id?: string
          actual_finish_date?: string | null
          actual_start_date?: string | null
          baseline_finish_date?: string | null
          baseline_start_date?: string | null
          created_at?: string
          division?: string
          finish_date?: string | null
          forecast_finish_date?: string | null
          forecast_start_date?: string | null
          id?: string
          name: string
          notes?: string
          percent_complete?: number
          predecessor_activity_ids?: string[]
          project_id: string
          remaining_duration_days?: number | null
          sort_order?: number
          start_date?: string | null
          successor_activity_ids?: string[]
          updated_at?: string
          wbs_section_id?: string | null
        }
        Update: {
          activity_id?: string
          actual_finish_date?: string | null
          actual_start_date?: string | null
          baseline_finish_date?: string | null
          baseline_start_date?: string | null
          created_at?: string
          division?: string
          finish_date?: string | null
          forecast_finish_date?: string | null
          forecast_start_date?: string | null
          id?: string
          name?: string
          notes?: string
          percent_complete?: number
          predecessor_activity_ids?: string[]
          project_id?: string
          remaining_duration_days?: number | null
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
      schedule_activity_progress_controls: {
        Row: {
          basis: string
          created_at: string
          planned_quantity: number | null
          project_id: string
          schedule_activity_id: string
          unit: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          basis?: string
          created_at?: string
          planned_quantity?: number | null
          project_id: string
          schedule_activity_id: string
          unit?: string
          updated_at?: string
          updated_by?: string
        }
        Update: {
          basis?: string
          created_at?: string
          planned_quantity?: number | null
          project_id?: string
          schedule_activity_id?: string
          unit?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_activity_progress_controls_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_activity_progress_controls_schedule_activity_id_fkey"
            columns: ["schedule_activity_id"]
            isOneToOne: true
            referencedRelation: "schedule_activities"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_activity_progress_reviews: {
        Row: {
          accepted_percent: number
          basis: string
          calculation_version: string
          current_percent: number
          decision: string
          id: string
          installed_quantity: number | null
          planned_quantity: number | null
          project_id: string
          recommended_percent: number
          review_note: string
          reviewed_at: string
          reviewed_by: string
          schedule_activity_id: string
          source_period_end: string
          source_period_start: string
          source_snapshot: Json
          source_wip_entry_id: string | null
          unit: string
        }
        Insert: {
          accepted_percent: number
          basis: string
          calculation_version?: string
          current_percent: number
          decision: string
          id?: string
          installed_quantity?: number | null
          planned_quantity?: number | null
          project_id: string
          recommended_percent: number
          review_note?: string
          reviewed_at?: string
          reviewed_by?: string
          schedule_activity_id: string
          source_period_end: string
          source_period_start: string
          source_snapshot?: Json
          source_wip_entry_id?: string | null
          unit?: string
        }
        Update: {
          accepted_percent?: number
          basis?: string
          calculation_version?: string
          current_percent?: number
          decision?: string
          id?: string
          installed_quantity?: number | null
          planned_quantity?: number | null
          project_id?: string
          recommended_percent?: number
          review_note?: string
          reviewed_at?: string
          reviewed_by?: string
          schedule_activity_id?: string
          source_period_end?: string
          source_period_start?: string
          source_snapshot?: Json
          source_wip_entry_id?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_activity_progress_reviews_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_activity_progress_reviews_schedule_activity_id_fkey"
            columns: ["schedule_activity_id"]
            isOneToOne: false
            referencedRelation: "schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_activity_progress_reviews_source_wip_entry_id_fkey"
            columns: ["source_wip_entry_id"]
            isOneToOne: false
            referencedRelation: "daily_wip_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_activity_updates: {
        Row: {
          activity_id: string
          actual_finish_date: string | null
          actual_start_date: string | null
          baseline_finish_date: string | null
          baseline_start_date: string | null
          created_at: string
          current_finish_date: string | null
          current_start_date: string | null
          data_date: string
          division: string
          free_float_days: number
          id: string
          is_critical: boolean
          is_late: boolean
          is_milestone: boolean
          is_near_critical: boolean
          is_open_finish: boolean
          is_open_start: boolean
          is_out_of_sequence: boolean
          name: string
          notes: string
          percent_complete: number
          planned_duration_days: number
          predecessor_activity_ids: string[]
          project_id: string
          remaining_duration_days: number
          schedule_activity_id: string | null
          schedule_update_id: string
          slippage_days: number
          status_basis: string
          successor_activity_ids: string[]
          total_float_days: number
          update_number: number
          updated_at: string
          wbs_section_id: string | null
        }
        Insert: {
          activity_id?: string
          actual_finish_date?: string | null
          actual_start_date?: string | null
          baseline_finish_date?: string | null
          baseline_start_date?: string | null
          created_at?: string
          current_finish_date?: string | null
          current_start_date?: string | null
          data_date: string
          division?: string
          free_float_days?: number
          id?: string
          is_critical?: boolean
          is_late?: boolean
          is_milestone?: boolean
          is_near_critical?: boolean
          is_open_finish?: boolean
          is_open_start?: boolean
          is_out_of_sequence?: boolean
          name?: string
          notes?: string
          percent_complete?: number
          planned_duration_days?: number
          predecessor_activity_ids?: string[]
          project_id: string
          remaining_duration_days?: number
          schedule_activity_id?: string | null
          schedule_update_id: string
          slippage_days?: number
          status_basis?: string
          successor_activity_ids?: string[]
          total_float_days?: number
          update_number: number
          updated_at?: string
          wbs_section_id?: string | null
        }
        Update: {
          activity_id?: string
          actual_finish_date?: string | null
          actual_start_date?: string | null
          baseline_finish_date?: string | null
          baseline_start_date?: string | null
          created_at?: string
          current_finish_date?: string | null
          current_start_date?: string | null
          data_date?: string
          division?: string
          free_float_days?: number
          id?: string
          is_critical?: boolean
          is_late?: boolean
          is_milestone?: boolean
          is_near_critical?: boolean
          is_open_finish?: boolean
          is_open_start?: boolean
          is_out_of_sequence?: boolean
          name?: string
          notes?: string
          percent_complete?: number
          planned_duration_days?: number
          predecessor_activity_ids?: string[]
          project_id?: string
          remaining_duration_days?: number
          schedule_activity_id?: string | null
          schedule_update_id?: string
          slippage_days?: number
          status_basis?: string
          successor_activity_ids?: string[]
          total_float_days?: number
          update_number?: number
          updated_at?: string
          wbs_section_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_activity_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_activity_updates_schedule_activity_id_fkey"
            columns: ["schedule_activity_id"]
            isOneToOne: false
            referencedRelation: "schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_activity_updates_schedule_update_id_fkey"
            columns: ["schedule_update_id"]
            isOneToOne: false
            referencedRelation: "schedule_updates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_activity_updates_wbs_section_id_fkey"
            columns: ["wbs_section_id"]
            isOneToOne: false
            referencedRelation: "schedule_wbs_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_cpm_templates: {
        Row: {
          activities: Json
          activity_count: number
          created_at: string
          description: string
          id: string
          name: string
          project_id: string
          updated_at: string
          wbs_sections: Json
        }
        Insert: {
          activities?: Json
          activity_count?: number
          created_at?: string
          description?: string
          id?: string
          name: string
          project_id: string
          updated_at?: string
          wbs_sections?: Json
        }
        Update: {
          activities?: Json
          activity_count?: number
          created_at?: string
          description?: string
          id?: string
          name?: string
          project_id?: string
          updated_at?: string
          wbs_sections?: Json
        }
        Relationships: [
          {
            foreignKeyName: "schedule_cpm_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
            foreignKeyName: "schedule_wbs_sections_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "schedule_wbs_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_wbs_sections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sov_imports: {
        Row: {
          amount_choices: Json
          column_map: Json
          confidence: string
          created_at: string
          has_header: boolean
          id: string
          imported_by: string | null
          inserted_count: number
          merged_rows: number
          mode: string
          operation_key: string | null
          original_cost_budget: number
          profile: string
          project_id: string
          raw_rows: number
          request_fingerprint: string | null
          selected_budget_column: number | null
          selected_budget_label: string
          skipped_count: number
          source_name: string
          source_sheet: string
          source_type: string
          staged_rows: number
          total_budget: number
          updated_count: number
          warnings: Json
        }
        Insert: {
          amount_choices?: Json
          column_map?: Json
          confidence?: string
          created_at?: string
          has_header?: boolean
          id?: string
          imported_by?: string | null
          inserted_count?: number
          merged_rows?: number
          mode?: string
          operation_key?: string | null
          original_cost_budget?: number
          profile?: string
          project_id: string
          raw_rows?: number
          request_fingerprint?: string | null
          selected_budget_column?: number | null
          selected_budget_label?: string
          skipped_count?: number
          source_name?: string
          source_sheet?: string
          source_type?: string
          staged_rows?: number
          total_budget?: number
          updated_count?: number
          warnings?: Json
        }
        Update: {
          amount_choices?: Json
          column_map?: Json
          confidence?: string
          created_at?: string
          has_header?: boolean
          id?: string
          imported_by?: string | null
          inserted_count?: number
          merged_rows?: number
          mode?: string
          operation_key?: string | null
          original_cost_budget?: number
          profile?: string
          project_id?: string
          raw_rows?: number
          request_fingerprint?: string | null
          selected_budget_column?: number | null
          selected_budget_label?: string
          skipped_count?: number
          source_name?: string
          source_sheet?: string
          source_type?: string
          staged_rows?: number
          total_budget?: number
          updated_count?: number
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "sov_imports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sov_mapping_profiles: {
        Row: {
          amount_choices: Json
          column_map: Json
          confidence: string
          created_at: string
          created_by: string | null
          has_header: boolean
          id: string
          last_used_at: string | null
          name: string
          normalized_name: string
          organization_id: string
          profile: string
          sample_headers: Json
          selected_budget_column: number | null
          selected_budget_label: string
          source_sheet: string
          source_type: string
          updated_at: string
          use_count: number
          warnings: Json
        }
        Insert: {
          amount_choices?: Json
          column_map?: Json
          confidence?: string
          created_at?: string
          created_by?: string | null
          has_header?: boolean
          id?: string
          last_used_at?: string | null
          name: string
          normalized_name: string
          organization_id: string
          profile?: string
          sample_headers?: Json
          selected_budget_column?: number | null
          selected_budget_label?: string
          source_sheet?: string
          source_type?: string
          updated_at?: string
          use_count?: number
          warnings?: Json
        }
        Update: {
          amount_choices?: Json
          column_map?: Json
          confidence?: string
          created_at?: string
          created_by?: string | null
          has_header?: boolean
          id?: string
          last_used_at?: string | null
          name?: string
          normalized_name?: string
          organization_id?: string
          profile?: string
          sample_headers?: Json
          selected_budget_column?: number | null
          selected_budget_label?: string
          source_sheet?: string
          source_type?: string
          updated_at?: string
          use_count?: number
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "sov_mapping_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_limit_requests: {
        Row: {
          created_at: string
          current_limit_cents: number
          id: string
          organization_id: string
          reason: string
          requested_by: string
          requested_limit_cents: number
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          stripe_request_reference: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_limit_cents: number
          id?: string
          organization_id: string
          reason?: string
          requested_by: string
          requested_limit_cents: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          stripe_request_reference?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_limit_cents?: number
          id?: string
          organization_id?: string
          reason?: string
          requested_by?: string
          requested_limit_cents?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          stripe_request_reference?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_limit_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          claimed_at: string
          event_id: string
          event_type: string
          livemode: boolean | null
          processed_at: string
          status: string
        }
        Insert: {
          claimed_at?: string
          event_id: string
          event_type?: string
          livemode?: boolean | null
          processed_at?: string
          status?: string
        }
        Update: {
          claimed_at?: string
          event_id?: string
          event_type?: string
          livemode?: boolean | null
          processed_at?: string
          status?: string
        }
        Relationships: []
      }
      subcontract_allocations: {
        Row: {
          amount: number
          benchmark_labor_rate: number
          cost_bucket_id: string | null
          cost_code: string
          created_at: string
          description: string
          id: string
          planned_quantity: number
          project_id: string
          subcontract_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          amount?: number
          benchmark_labor_rate?: number
          cost_bucket_id?: string | null
          cost_code?: string
          created_at?: string
          description?: string
          id?: string
          planned_quantity?: number
          project_id: string
          subcontract_id: string
          unit?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          benchmark_labor_rate?: number
          cost_bucket_id?: string | null
          cost_code?: string
          created_at?: string
          description?: string
          id?: string
          planned_quantity?: number
          project_id?: string
          subcontract_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcontract_allocations_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_allocations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_allocations_subcontract_id_fkey"
            columns: ["subcontract_id"]
            isOneToOne: false
            referencedRelation: "subcontracts"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontract_authority_operations: {
        Row: {
          changed_by: string
          created_at: string
          id: string
          operation_key: string
          operation_type: string
          project_id: string
          request_fingerprint: string
          resource_id: string
          result: Json
          subcontract_id: string | null
        }
        Insert: {
          changed_by: string
          created_at?: string
          id?: string
          operation_key: string
          operation_type: string
          project_id: string
          request_fingerprint: string
          resource_id: string
          result: Json
          subcontract_id?: string | null
        }
        Update: {
          changed_by?: string
          created_at?: string
          id?: string
          operation_key?: string
          operation_type?: string
          project_id?: string
          request_fingerprint?: string
          resource_id?: string
          result?: Json
          subcontract_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subcontract_authority_operations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontract_change_orders: {
        Row: {
          amount: number
          co_date: string
          cost_bucket_id: string | null
          cost_code: string
          created_at: string
          description: string
          exposure_id: string | null
          id: string
          project_id: string
          subcontract_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          co_date?: string
          cost_bucket_id?: string | null
          cost_code?: string
          created_at?: string
          description?: string
          exposure_id?: string | null
          id?: string
          project_id: string
          subcontract_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          co_date?: string
          cost_bucket_id?: string | null
          cost_code?: string
          created_at?: string
          description?: string
          exposure_id?: string | null
          id?: string
          project_id?: string
          subcontract_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcontract_change_orders_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_change_orders_exposure_id_fkey"
            columns: ["exposure_id"]
            isOneToOne: false
            referencedRelation: "exposures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_change_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_change_orders_subcontract_id_fkey"
            columns: ["subcontract_id"]
            isOneToOne: false
            referencedRelation: "subcontracts"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontract_documents: {
        Row: {
          created_at: string
          file_name: string
          id: string
          is_active: boolean
          note: string
          project_id: string
          storage_path: string
          subcontract_id: string
          uploaded_at: string
        }
        Insert: {
          created_at?: string
          file_name?: string
          id?: string
          is_active?: boolean
          note?: string
          project_id: string
          storage_path: string
          subcontract_id: string
          uploaded_at?: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          is_active?: boolean
          note?: string
          project_id?: string
          storage_path?: string
          subcontract_id?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcontract_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_documents_subcontract_id_fkey"
            columns: ["subcontract_id"]
            isOneToOne: false
            referencedRelation: "subcontracts"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontract_payment_allocations: {
        Row: {
          amount: number
          cost_bucket_id: string | null
          cost_code: string
          created_at: string
          description: string
          id: string
          payment_id: string
          project_id: string
          subcontract_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          cost_bucket_id?: string | null
          cost_code?: string
          created_at?: string
          description?: string
          id?: string
          payment_id: string
          project_id: string
          subcontract_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          cost_bucket_id?: string | null
          cost_code?: string
          created_at?: string
          description?: string
          id?: string
          payment_id?: string
          project_id?: string
          subcontract_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcontract_payment_allocations_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "subcontract_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_payment_allocations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_payment_allocations_subcontract_id_fkey"
            columns: ["subcontract_id"]
            isOneToOne: false
            referencedRelation: "subcontracts"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontract_payment_draft_operations: {
        Row: {
          changed_by: string
          created_at: string
          id: string
          operation_key: string
          operation_type: string
          payment_id: string
          project_id: string
          request_fingerprint: string
          result: Json
        }
        Insert: {
          changed_by: string
          created_at?: string
          id?: string
          operation_key: string
          operation_type: string
          payment_id: string
          project_id: string
          request_fingerprint: string
          result?: Json
        }
        Update: {
          changed_by?: string
          created_at?: string
          id?: string
          operation_key?: string
          operation_type?: string
          payment_id?: string
          project_id?: string
          request_fingerprint?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "subcontract_payment_draft_operations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontract_payments: {
        Row: {
          amount: number
          approved_at: string | null
          compliance_overridden_at: string | null
          compliance_overridden_by: string | null
          compliance_override_reason: string
          created_at: string
          exposure_id: string | null
          id: string
          idempotency_fingerprint: string | null
          idempotency_key: string | null
          notes: string
          payment_date: string
          payment_method: string
          project_id: string
          reference: string
          retainage_held: number
          status: string
          subcontract_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          approved_at?: string | null
          compliance_overridden_at?: string | null
          compliance_overridden_by?: string | null
          compliance_override_reason?: string
          created_at?: string
          exposure_id?: string | null
          id?: string
          idempotency_fingerprint?: string | null
          idempotency_key?: string | null
          notes?: string
          payment_date?: string
          payment_method?: string
          project_id: string
          reference?: string
          retainage_held?: number
          status?: string
          subcontract_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          compliance_overridden_at?: string | null
          compliance_overridden_by?: string | null
          compliance_override_reason?: string
          created_at?: string
          exposure_id?: string | null
          id?: string
          idempotency_fingerprint?: string | null
          idempotency_key?: string | null
          notes?: string
          payment_date?: string
          payment_method?: string
          project_id?: string
          reference?: string
          retainage_held?: number
          status?: string
          subcontract_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcontract_payments_exposure_id_fkey"
            columns: ["exposure_id"]
            isOneToOne: false
            referencedRelation: "exposures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_payments_subcontract_id_fkey"
            columns: ["subcontract_id"]
            isOneToOne: false
            referencedRelation: "subcontracts"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontractors: {
        Row: {
          contact_email: string
          contact_name: string
          contact_phone: string
          created_at: string
          id: string
          name: string
          notes: string
          organization_id: string
          source: string
          trade: string
          updated_at: string
        }
        Insert: {
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          created_at?: string
          id?: string
          name: string
          notes?: string
          organization_id: string
          source?: string
          trade?: string
          updated_at?: string
        }
        Update: {
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string
          organization_id?: string
          source?: string
          trade?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcontractors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontracts: {
        Row: {
          contract_value: number
          created_at: string
          executed_at: string | null
          executed_contract_name: string
          executed_contract_path: string
          executed_contract_uploaded_at: string | null
          id: string
          project_id: string
          retainage_pct: number
          scope: string
          status: string
          subcontractor_id: string
          title: string
          updated_at: string
        }
        Insert: {
          contract_value?: number
          created_at?: string
          executed_at?: string | null
          executed_contract_name?: string
          executed_contract_path?: string
          executed_contract_uploaded_at?: string | null
          id?: string
          project_id: string
          retainage_pct?: number
          scope?: string
          status?: string
          subcontractor_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          contract_value?: number
          created_at?: string
          executed_at?: string | null
          executed_contract_name?: string
          executed_contract_path?: string
          executed_contract_uploaded_at?: string | null
          id?: string
          project_id?: string
          retainage_pct?: number
          scope?: string
          status?: string
          subcontractor_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcontracts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontracts_subcontractor_id_fkey"
            columns: ["subcontractor_id"]
            isOneToOne: false
            referencedRelation: "subcontractors"
            referencedColumns: ["id"]
          },
        ]
      }
      submittal_log_entries: {
        Row: {
          comments: string
          created_at: string
          date_returned: string | null
          date_submitted: string | null
          description: string
          due_date: string | null
          file_name: string
          id: string
          item: string
          kind: string
          mfgr_supplier: string
          number: string
          project_id: string
          sort_order: number
          spec_section: string
          status: string
          storage_path: string
          sub_rev: string
          updated_at: string
        }
        Insert: {
          comments?: string
          created_at?: string
          date_returned?: string | null
          date_submitted?: string | null
          description?: string
          due_date?: string | null
          file_name?: string
          id?: string
          item?: string
          kind?: string
          mfgr_supplier?: string
          number?: string
          project_id: string
          sort_order?: number
          spec_section?: string
          status?: string
          storage_path?: string
          sub_rev?: string
          updated_at?: string
        }
        Update: {
          comments?: string
          created_at?: string
          date_returned?: string | null
          date_submitted?: string | null
          description?: string
          due_date?: string | null
          file_name?: string
          id?: string
          item?: string
          kind?: string
          mfgr_supplier?: string
          number?: string
          project_id?: string
          sort_order?: number
          spec_section?: string
          status?: string
          storage_path?: string
          sub_rev?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submittal_log_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          checkout_enabled: boolean
          code: string
          created_at: string
          daily_report_limit_per_month: number | null
          is_public: boolean
          monthly_ai_credits: number
          monthly_price_cents: number
          name: string
          project_limit: number | null
          seat_limit: number | null
          storage_limit_mb: number | null
          stripe_price_id: string
          stripe_product_id: string
          updated_at: string
        }
        Insert: {
          checkout_enabled?: boolean
          code: string
          created_at?: string
          daily_report_limit_per_month?: number | null
          is_public?: boolean
          monthly_ai_credits?: number
          monthly_price_cents?: number
          name: string
          project_limit?: number | null
          seat_limit?: number | null
          storage_limit_mb?: number | null
          stripe_price_id?: string
          stripe_product_id?: string
          updated_at?: string
        }
        Update: {
          checkout_enabled?: boolean
          code?: string
          created_at?: string
          daily_report_limit_per_month?: number | null
          is_public?: boolean
          monthly_ai_credits?: number
          monthly_price_cents?: number
          name?: string
          project_limit?: number | null
          seat_limit?: number | null
          storage_limit_mb?: number | null
          stripe_price_id?: string
          stripe_product_id?: string
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
      tomorrow_plan_items: {
        Row: {
          activity: string
          benchmark_rate: number | null
          benchmark_source: string
          benchmark_source_id: string | null
          confirmation_status: string
          confirmed_at: string | null
          confirmed_by: string | null
          constraint_owner: string
          constraint_summary: string
          cost_bucket_id: string | null
          created_at: string
          created_by: string | null
          crew_count: number
          equipment: string
          equipment_ready: boolean
          hours_per_person: number
          id: string
          information: string
          information_ready: boolean
          inspection: string
          inspection_ready: boolean
          materials: string
          materials_ready: boolean
          notes: string
          people_per_crew: number
          performer_name: string
          performer_type: string
          plan_date: string
          planned_quantity: number
          project_id: string
          schedule_activity_id: string | null
          status: string
          subcontractor_id: string | null
          target_rate: number | null
          unit: string
          updated_at: string
          work_area: string
          work_area_ready: boolean
        }
        Insert: {
          activity?: string
          benchmark_rate?: number | null
          benchmark_source?: string
          benchmark_source_id?: string | null
          confirmation_status?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          constraint_owner?: string
          constraint_summary?: string
          cost_bucket_id?: string | null
          created_at?: string
          created_by?: string | null
          crew_count?: number
          equipment?: string
          equipment_ready?: boolean
          hours_per_person?: number
          id?: string
          information?: string
          information_ready?: boolean
          inspection?: string
          inspection_ready?: boolean
          materials?: string
          materials_ready?: boolean
          notes?: string
          people_per_crew?: number
          performer_name?: string
          performer_type?: string
          plan_date: string
          planned_quantity?: number
          project_id: string
          schedule_activity_id?: string | null
          status?: string
          subcontractor_id?: string | null
          target_rate?: number | null
          unit?: string
          updated_at?: string
          work_area?: string
          work_area_ready?: boolean
        }
        Update: {
          activity?: string
          benchmark_rate?: number | null
          benchmark_source?: string
          benchmark_source_id?: string | null
          confirmation_status?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          constraint_owner?: string
          constraint_summary?: string
          cost_bucket_id?: string | null
          created_at?: string
          created_by?: string | null
          crew_count?: number
          equipment?: string
          equipment_ready?: boolean
          hours_per_person?: number
          id?: string
          information?: string
          information_ready?: boolean
          inspection?: string
          inspection_ready?: boolean
          materials?: string
          materials_ready?: boolean
          notes?: string
          people_per_crew?: number
          performer_name?: string
          performer_type?: string
          plan_date?: string
          planned_quantity?: number
          project_id?: string
          schedule_activity_id?: string | null
          status?: string
          subcontractor_id?: string | null
          target_rate?: number | null
          unit?: string
          updated_at?: string
          work_area?: string
          work_area_ready?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tomorrow_plan_items_benchmark_source_id_fkey"
            columns: ["benchmark_source_id"]
            isOneToOne: false
            referencedRelation: "subcontract_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tomorrow_plan_items_cost_bucket_id_fkey"
            columns: ["cost_bucket_id"]
            isOneToOne: false
            referencedRelation: "cost_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tomorrow_plan_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tomorrow_plan_items_schedule_activity_id_fkey"
            columns: ["schedule_activity_id"]
            isOneToOne: false
            referencedRelation: "schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tomorrow_plan_items_subcontractor_id_fkey"
            columns: ["subcontractor_id"]
            isOneToOne: false
            referencedRelation: "subcontractors"
            referencedColumns: ["id"]
          },
        ]
      }
      transmittals: {
        Row: {
          attn: string
          created_at: string
          entry_ids: string[]
          file_name: string
          id: string
          kind: string
          notes: string
          number: string
          project_id: string
          re: string
          sent_at: string | null
          sent_by: string
          storage_path: string
          to_party: string
          updated_at: string
        }
        Insert: {
          attn?: string
          created_at?: string
          entry_ids?: string[]
          file_name?: string
          id?: string
          kind?: string
          notes?: string
          number?: string
          project_id: string
          re?: string
          sent_at?: string | null
          sent_by?: string
          storage_path?: string
          to_party?: string
          updated_at?: string
        }
        Update: {
          attn?: string
          created_at?: string
          entry_ids?: string[]
          file_name?: string
          id?: string
          kind?: string
          notes?: string
          number?: string
          project_id?: string
          re?: string
          sent_at?: string | null
          sent_by?: string
          storage_path?: string
          to_party?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transmittals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_presence: {
        Row: {
          client_session_id: string
          created_at: string
          email: string
          full_name: string
          id: string
          last_seen_at: string
          login_at: string
          organization_id: string
          page_title: string
          route_path: string
          updated_at: string
          user_agent: string
          user_id: string
        }
        Insert: {
          client_session_id: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          last_seen_at?: string
          login_at?: string
          organization_id: string
          page_title?: string
          route_path?: string
          updated_at?: string
          user_agent?: string
          user_id: string
        }
        Update: {
          client_session_id?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          last_seen_at?: string
          login_at?: string
          organization_id?: string
          page_title?: string
          route_path?: string
          updated_at?: string
          user_agent?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_activity_presence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_activity_presence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string
          contact_email: string
          contact_name: string
          contact_phone: string
          created_at: string
          id: string
          name: string
          notes: string
          organization_id: string
          source: string
          trade: string
          updated_at: string
        }
        Insert: {
          address?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          created_at?: string
          id?: string
          name: string
          notes?: string
          organization_id: string
          source?: string
          trade?: string
          updated_at?: string
        }
        Update: {
          address?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string
          organization_id?: string
          source?: string
          trade?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allocate_change_order_atomic: {
        Args: {
          p_change_order_id: string
          p_contract_amount_cents: number
          p_cost_amount_cents?: number
          p_cost_bucket_id: string
          p_idempotency_key?: string
          p_project_id: string
        }
        Returns: Json
      }
      append_invoice_collections_note_atomic: {
        Args: {
          p_billing_invoice_id: string
          p_idempotency_key: string
          p_note: string
        }
        Returns: Json
      }
      apply_billing_line_item_mutations_atomic: {
        Args: { p_items: Json; p_operation_key: string }
        Returns: Json
      }
      apply_estimate_takeoff_line_rollup_internal: {
        Args: {
          p_estimate_id: string
          p_force_manual?: boolean
          p_force_unit?: boolean
          p_line_item_id: string
        }
        Returns: Json
      }
      apply_production_sov_certification_to_billing: {
        Args: { p_billing_application_id: string; p_certification_id: string }
        Returns: Json
      }
      apply_wip_schedule_progress_review: {
        Args: {
          p_accepted_percent: number
          p_basis: string
          p_current_percent: number
          p_decision: string
          p_installed_quantity: number
          p_note: string
          p_planned_quantity: number
          p_project_id: string
          p_recommended_percent: number
          p_schedule_activity_id: string
          p_source_period_end: string
          p_source_period_start: string
          p_source_snapshot: Json
          p_source_wip_entry_id: string
          p_unit: string
        }
        Returns: {
          accepted_percent: number
          basis: string
          calculation_version: string
          current_percent: number
          decision: string
          id: string
          installed_quantity: number | null
          planned_quantity: number | null
          project_id: string
          recommended_percent: number
          review_note: string
          reviewed_at: string
          reviewed_by: string
          schedule_activity_id: string
          source_period_end: string
          source_period_start: string
          source_snapshot: Json
          source_wip_entry_id: string | null
          unit: string
        }
        SetofOptions: {
          from: "*"
          to: "schedule_activity_progress_reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_safe_accounting_cents: {
        Args: { p_allow_negative?: boolean; p_cents: number; p_label: string }
        Returns: number
      }
      attach_lien_waiver_to_payment_atomic: {
        Args: { p_payment_id: string; p_waiver_id: string }
        Returns: boolean
      }
      build_budget_from_estimate_atomic: {
        Args: {
          p_operation_key: string
          p_pricing: string
          p_project_id: string
        }
        Returns: Json
      }
      build_estimate_review_snapshot: {
        Args: { p_estimate_id: string }
        Returns: Json
      }
      calculate_estimate_takeoff_geometry: {
        Args: {
          p_geometry: Json
          p_sheet: Database["public"]["Tables"]["estimate_plan_sheets"]["Row"]
          p_tool_type: string
          p_unit: string
        }
        Returns: Json
      }
      calculate_takeoff_assembly_outputs: {
        Args: {
          p_geometry_quantity: number
          p_inputs: Json
          p_template_id: string
        }
        Returns: Json
      }
      can_approve_client_change_order: {
        Args: { p_change_order_id: string }
        Returns: boolean
      }
      can_create_project_in_org: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      can_manage_billing: { Args: { p_project_id: string }; Returns: boolean }
      can_manage_client_access: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      can_manage_estimate: { Args: { p_estimate_id: string }; Returns: boolean }
      can_manage_org: { Args: { p_org_id: string }; Returns: boolean }
      can_manage_project: { Args: { p_project_id: string }; Returns: boolean }
      can_manage_schedule: { Args: { p_project_id: string }; Returns: boolean }
      can_read_client_project: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      can_read_estimate: { Args: { p_estimate_id: string }; Returns: boolean }
      can_read_project: { Args: { p_project_id: string }; Returns: boolean }
      can_view_client_billing: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      can_view_client_change_orders: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      can_view_client_daily_reports: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      can_view_client_selection: {
        Args: { p_selection_id: string }
        Returns: boolean
      }
      can_view_client_selections: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      can_view_financials: { Args: { p_project_id: string }; Returns: boolean }
      can_write_cost_library: { Args: { p_org_id: string }; Returns: boolean }
      can_write_crm: { Args: { p_org_id: string }; Returns: boolean }
      certify_production_sov_position_atomic: {
        Args: {
          p_cost_bucket_id: string
          p_expected_current_sov_percent: number
          p_expected_source_review_version: number
          p_expected_source_wip_entry_id: string
          p_operation_key: string
          p_payload: Json
          p_project_id: string
        }
        Returns: Json
      }
      complete_estimate_measurement_scope_item: {
        Args: { p_scope_item_id: string; p_takeoff_measurement_id: string }
        Returns: {
          ai_operation_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          decision_at: string
          decision_by: string | null
          estimate_id: string
          estimate_line_item_id: string | null
          guide_geometry: Json
          guide_source: string | null
          id: string
          label: string
          library_item_id: string | null
          plan_sheet_id: string
          scope_key: string
          source_anchor: Json
          source_excerpt: string
          source_line: string
          status: string
          suggestion_key: string
          takeoff_measurement_id: string | null
          tool_type: string
          unit: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "estimate_measurement_scope_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      convert_estimate_to_sov_atomic: {
        Args: {
          p_client: string
          p_estimate_id: string
          p_operation_key: string
          p_project_id: string
        }
        Returns: Json
      }
      convert_pipeline_opportunity_to_project: {
        Args: { p_opportunity_id: string }
        Returns: string
      }
      correct_billing_invoice_atomic: {
        Args: {
          p_billing_invoice_id: string
          p_expected_updated_at: string
          p_idempotency_key: string
          p_reason: string
          p_replacement_payload: Json
        }
        Returns: Json
      }
      cost_actual_rollup_amount: {
        Args: { p_amount: number; p_status: string }
        Returns: number
      }
      create_billing_application_atomic: {
        Args: {
          p_idempotency_key: string
          p_payload: Json
          p_project_id: string
        }
        Returns: Json
      }
      create_billing_invoice_atomic: {
        Args: {
          p_idempotency_key: string
          p_payload: Json
          p_project_id: string
        }
        Returns: Json
      }
      create_change_order_atomic: {
        Args: {
          p_co_type: string
          p_contract_amount_cents: number
          p_cost_amount_cents: number
          p_date_initiated: string
          p_description: string
          p_financial_direction: string
          p_notes: string
          p_number: string
          p_operation_key: string
          p_owner: string
          p_pricing_method: string
          p_probability: number
          p_project_id: string
          p_requested_by: string
          p_requested_id?: string
          p_schedule_impact_days: number
          p_status: string
        }
        Returns: Json
      }
      create_cost_actual_atomic: {
        Args: {
          p_idempotency_key: string
          p_payload: Json
          p_project_id: string
        }
        Returns: Json
      }
      create_cost_bucket_atomic: {
        Args: { p_operation_key: string; p_payload: Json; p_project_id: string }
        Returns: Json
      }
      create_estimate_atomic: {
        Args: {
          p_header: Json
          p_initial_lines: Json
          p_operation_key: string
          p_organization_id: string
        }
        Returns: Json
      }
      create_estimate_line_items_atomic: {
        Args: { p_estimate_id: string; p_lines: Json; p_operation_key: string }
        Returns: Json
      }
      create_exposure_allocation_atomic: {
        Args: {
          p_amount_cents: number
          p_cost_bucket_id: string
          p_exposure_id: string
          p_operation_key: string
          p_project_id: string
        }
        Returns: Json
      }
      create_notification: {
        Args: {
          p_body?: string
          p_data?: Json
          p_entity_id?: string
          p_entity_type?: string
          p_organization_id: string
          p_project_id?: string
          p_recipient_id: string
          p_title?: string
          p_type: string
          p_url?: string
        }
        Returns: string
      }
      create_project_financial_atomic: {
        Args: {
          p_header: Json
          p_operation_key: string
          p_organization_id: string
        }
        Returns: Json
      }
      delete_billing_application_draft_atomic: {
        Args: { p_billing_application_id: string; p_idempotency_key: string }
        Returns: Json
      }
      delete_billing_invoice_draft_atomic: {
        Args: { p_billing_invoice_id: string; p_idempotency_key: string }
        Returns: Json
      }
      delete_change_order_allocation_atomic: {
        Args: { p_allocation_id: string }
        Returns: Json
      }
      delete_change_order_atomic: {
        Args: {
          p_change_order_id: string
          p_expected_updated_at: string
          p_operation_key: string
          p_project_id: string
        }
        Returns: Json
      }
      delete_cost_bucket_atomic: {
        Args: {
          p_bucket_id: string
          p_operation_key: string
          p_project_id: string
        }
        Returns: Json
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_estimate_line_item_atomic: {
        Args: {
          p_estimate_id: string
          p_line_item_id: string
          p_operation_key: string
        }
        Returns: Json
      }
      delete_exposure_allocation_atomic: {
        Args: {
          p_allocation_id: string
          p_expected_version: number
          p_operation_key: string
        }
        Returns: Json
      }
      delete_subcontract_payment_draft_atomic: {
        Args: {
          p_expected_updated_at: string
          p_operation_key: string
          p_payment_id: string
        }
        Returns: Json
      }
      delete_untouched_subcontract_draft_atomic: {
        Args: {
          p_expected_updated_at: string
          p_operation_key: string
          p_subcontract_id: string
        }
        Returns: Json
      }
      detach_lien_waiver_from_payment_atomic: {
        Args: { p_payment_id: string; p_waiver_id: string }
        Returns: boolean
      }
      duplicate_estimate_atomic: {
        Args: {
          p_mode: string
          p_operation_key: string
          p_source_estimate_id: string
        }
        Returns: Json
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_current_user_account: { Args: never; Returns: string }
      ensure_monthly_ai_credit_grant: {
        Args: { p_organization_id: string }
        Returns: number
      }
      ensure_user_account: {
        Args: { p_email: string; p_full_name?: string; p_user_id: string }
        Returns: string
      }
      estimate_review_snapshot_hash: {
        Args: { p_snapshot: Json }
        Returns: string
      }
      finalize_client_access_acceptance: {
        Args: { p_client_access_id: string }
        Returns: string
      }
      finalize_invite_acceptance: {
        Args: { p_invite_id: string }
        Returns: string
      }
      generate_billing_line_items_atomic: {
        Args: { p_billing_application_id: string; p_project_id: string }
        Returns: Json
      }
      get_estimate_review_state: {
        Args: { p_estimate_id: string }
        Returns: Json
      }
      get_org_credit_balance: { Args: { p_org_id: string }; Returns: number }
      handoff_estimate_takeoff_assembly_output: {
        Args: {
          p_assembly_id: string
          p_destination_type: string
          p_estimate_line_item_id?: string
          p_label?: string
          p_library_item_id?: string
          p_output_key: string
        }
        Returns: {
          assembly_id: string
          created_at: string
          estimate_id: string
          estimate_line_item_id: string
          formula_version: string
          id: string
          last_synced_at: string
          linked_at: string
          linked_by: string | null
          output_key: string
          output_label: string
          output_quantity: number
          output_unit: string
          stale_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "estimate_takeoff_assembly_output_links"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_org_capability: {
        Args: { p_capability: string; p_org_id: string }
        Returns: boolean
      }
      import_cost_actuals_atomic: {
        Args: {
          p_idempotency_key: string
          p_project_id: string
          p_rows: Json
          p_source_name: string
        }
        Returns: Json
      }
      import_cost_buckets_atomic: {
        Args: {
          p_metadata: Json
          p_mode: string
          p_operation_key: string
          p_project_id: string
          p_rows: Json
        }
        Returns: Json
      }
      import_estimate_line_items_atomic: {
        Args: {
          p_estimate_id: string
          p_idempotency_key?: string
          p_mode: string
          p_rows: Json
        }
        Returns: Json
      }
      insert_estimate_lines_authoritative: {
        Args: { p_estimate_id: string; p_lines: Json }
        Returns: Json
      }
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      link_change_order_exposure_atomic: {
        Args: { p_change_order_id: string; p_exposure_id: string }
        Returns: Json
      }
      link_claim_change_order_atomic: {
        Args: { p_change_order_id: string; p_claim_id: string }
        Returns: Json
      }
      link_estimate_takeoff_group_atomic: {
        Args: {
          p_estimate_id: string
          p_expected_versions: number[]
          p_force_manual?: boolean
          p_force_unit?: boolean
          p_line_item_id: string
          p_measurement_ids: string[]
          p_operation_key: string
        }
        Returns: Json
      }
      lock_project_budget_atomic: {
        Args: { p_operation_key: string; p_project_id: string }
        Returns: Json
      }
      lookup_auth_user_by_email_exact: {
        Args: { p_email: string }
        Returns: {
          email_confirmed: boolean
          user_id: string
        }[]
      }
      mark_all_notifications_read: {
        Args: { p_organization_id?: string }
        Returns: number
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      mutate_estimate_takeoff_measurement_atomic: {
        Args: {
          p_action: string
          p_estimate_id: string
          p_expected_version: number
          p_force_manual?: boolean
          p_force_unit?: boolean
          p_measurement_id: string
          p_operation_key: string
          p_patch: Json
          p_recalculate_from_geometry: boolean
        }
        Returns: Json
      }
      mutate_subcontract_allocation_atomic: {
        Args: {
          p_allocation_id: string
          p_delete: boolean
          p_expected_updated_at: string
          p_operation_key: string
          p_patch: Json
          p_subcontract_id: string
        }
        Returns: Json
      }
      mutate_subcontract_change_order_atomic: {
        Args: {
          p_change_order_id: string
          p_delete: boolean
          p_expected_updated_at: string
          p_operation_key: string
          p_patch: Json
          p_subcontract_id: string
        }
        Returns: Json
      }
      normalize_assembly_output_unit: {
        Args: { p_unit: string }
        Returns: string
      }
      organizations_directory: {
        Args: { p_org_id: string }
        Returns: {
          billing_status: string
          daily_report_limit_per_month: number
          id: string
          logo_path: string
          logo_url: string
          name: string
          plan_code: string
          project_limit: number
          seat_limit: number
          slug: string
          storage_limit_mb: number
        }[]
      }
      overwatch_access_email_key: { Args: { p_email: string }; Returns: string }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recalculate_estimate_takeoff_sheet_atomic: {
        Args: {
          p_estimate_id: string
          p_expected_scale_revision: number
          p_force_manual?: boolean
          p_force_unit?: boolean
          p_operation_key: string
          p_plan_sheet_id: string
        }
        Returns: Json
      }
      recalculate_estimate_totals_atomic: {
        Args: { p_estimate_id: string }
        Returns: Json
      }
      recalculate_estimate_totals_from_lines: {
        Args: { p_estimate_id: string }
        Returns: Json
      }
      reconcile_invoice_payment_rollup: {
        Args: { p_invoice_id: string }
        Returns: Json
      }
      reconcile_invoice_payment_rollups: {
        Args: { p_application_ids?: string[]; p_invoice_ids: string[] }
        Returns: Json
      }
      record_billing_invoice_portal_view_atomic: {
        Args: {
          p_billing_invoice_id: string
          p_event_key: string
          p_user_agent?: string
          p_viewer_email: string
          p_viewer_user_id: string
        }
        Returns: Json
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
      record_client_selection_decision: {
        Args: {
          p_decision: string
          p_notes?: string
          p_option_id: string
          p_selection_id: string
          p_user_agent?: string
        }
        Returns: string
      }
      record_cost_actual_payment: {
        Args: {
          p_amount_cents: number
          p_cost_actual_id: string
          p_notes?: string
          p_payment_date?: string
          p_payment_method?: string
          p_payment_reference?: string
        }
        Returns: Json
      }
      record_cost_actual_payment_atomic: {
        Args: {
          p_amount_cents: number
          p_cost_actual_id: string
          p_idempotency_key: string
          p_notes: string
          p_payment_date: string
          p_payment_method: string
          p_payment_reference: string
        }
        Returns: Json
      }
      record_estimate_measurement_scope_decision:
        | {
            Args: {
              p_ai_operation_id: string
              p_estimate_id: string
              p_guide_geometry: Json
              p_label: string
              p_plan_sheet_id: string
              p_scope_key: string
              p_source_anchor: Json
              p_source_excerpt: string
              p_source_line: string
              p_status: string
              p_suggestion_key: string
              p_tool_type: string
              p_unit: string
            }
            Returns: {
              ai_operation_id: string | null
              completed_at: string | null
              completed_by: string | null
              created_at: string
              created_by: string | null
              decision_at: string
              decision_by: string | null
              estimate_id: string
              estimate_line_item_id: string | null
              guide_geometry: Json
              guide_source: string | null
              id: string
              label: string
              library_item_id: string | null
              plan_sheet_id: string
              scope_key: string
              source_anchor: Json
              source_excerpt: string
              source_line: string
              status: string
              suggestion_key: string
              takeoff_measurement_id: string | null
              tool_type: string
              unit: string
              updated_at: string
            }[]
            SetofOptions: {
              from: "*"
              to: "estimate_measurement_scope_items"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              p_ai_operation_id: string
              p_estimate_id: string
              p_label: string
              p_plan_sheet_id: string
              p_scope_key: string
              p_source_anchor: Json
              p_source_excerpt: string
              p_source_line: string
              p_status: string
              p_suggestion_key: string
              p_tool_type: string
              p_unit: string
            }
            Returns: {
              ai_operation_id: string | null
              completed_at: string | null
              completed_by: string | null
              created_at: string
              created_by: string | null
              decision_at: string
              decision_by: string | null
              estimate_id: string
              estimate_line_item_id: string | null
              guide_geometry: Json
              guide_source: string | null
              id: string
              label: string
              library_item_id: string | null
              plan_sheet_id: string
              scope_key: string
              source_anchor: Json
              source_excerpt: string
              source_line: string
              status: string
              suggestion_key: string
              takeoff_measurement_id: string | null
              tool_type: string
              unit: string
              updated_at: string
            }[]
            SetofOptions: {
              from: "*"
              to: "estimate_measurement_scope_items"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      record_estimate_review_activity: {
        Args: { p_activity_type: string; p_estimate_id: string; p_note: string }
        Returns: {
          activity_type: string
          blocker_count: number
          created_at: string
          estimate_id: string
          follow_up_count: number
          id: string
          note: string
          organization_id: string
          reviewed_at: string
          reviewed_by: string
          sequence: number
          snapshot: Json
          snapshot_hash: string
          total_cents: number
        }[]
        SetofOptions: {
          from: "*"
          to: "estimate_review_activities"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_estimate_scale_assessment: {
        Args: {
          p_checks: Json
          p_estimate_id: string
          p_notes?: string
          p_plan_sheet_id: string
          p_scale_revision: number
        }
        Returns: {
          assessment_id: string
          evidence: Json
          max_variance_pct: number
          outcome: string
          scale_spread_pct: number
          verified_at: string
        }[]
      }
      record_invoice_payment_atomic: {
        Args: {
          p_amount_cents: number
          p_idempotency_key?: string
          p_invoice_id: string
          p_notes?: string
          p_overwatch_fee_cents?: number
          p_paid_at?: string
          p_payment_method?: string
          p_processor?: string
          p_processor_fee_cents?: number
          p_processor_payment_id?: string
          p_reference?: string
        }
        Returns: Json
      }
      record_invoice_payment_atomic_internal: {
        Args: {
          p_amount_cents: number
          p_idempotency_key?: string
          p_invoice_id: string
          p_notes?: string
          p_overwatch_fee_cents?: number
          p_paid_at?: string
          p_payment_method?: string
          p_processor?: string
          p_processor_fee_cents?: number
          p_processor_payment_id?: string
          p_reference?: string
        }
        Returns: Json
      }
      record_invoice_payment_atomic_pre_invoice_commands: {
        Args: {
          p_amount_cents: number
          p_idempotency_key?: string
          p_invoice_id: string
          p_notes?: string
          p_overwatch_fee_cents?: number
          p_paid_at?: string
          p_payment_method?: string
          p_processor?: string
          p_processor_fee_cents?: number
          p_processor_payment_id?: string
          p_reference?: string
        }
        Returns: Json
      }
      record_stripe_invoice_payment_atomic: {
        Args: {
          p_amount_cents: number
          p_balance_transaction_currency: string
          p_balance_transaction_fee_cents: number
          p_balance_transaction_gross_cents: number
          p_balance_transaction_net_cents: number
          p_charge_id?: string
          p_checkout_session_id?: string
          p_cumulative_refunded_gross_cents?: number
          p_gross_received_cents?: number
          p_invoice_id: string
          p_notes?: string
          p_overwatch_fee_cents?: number
          p_paid_at?: string
          p_payment_intent_id?: string
          p_payment_method?: string
          p_processor_payment_id?: string
          p_receipt_url?: string
          p_reference?: string
          p_refund_idempotency_key?: string
          p_refund_processor_event_id?: string
          p_stripe_balance_transaction_id: string
          p_surcharge_cents?: number
        }
        Returns: Json
      }
      record_subcontract_payment_atomic: {
        Args: {
          p_amount_cents: number
          p_exposure_id?: string
          p_idempotency_key?: string
          p_notes?: string
          p_override_reason?: string
          p_payment_date: string
          p_project_id: string
          p_reference?: string
          p_retainage_held_cents: number
          p_status?: string
          p_subcontract_id: string
        }
        Returns: Json
      }
      refund_invoice_payment_atomic: {
        Args: {
          p_cumulative_refunded_gross_cents: number
          p_idempotency_key?: string
          p_notes?: string
          p_payment_id: string
          p_processor_event_id?: string
          p_receipt_url?: string
          p_stripe_charge_id?: string
        }
        Returns: Json
      }
      reorder_estimate_line_items_atomic: {
        Args: {
          p_estimate_id: string
          p_expected_item_ids: string[]
          p_item_ids: string[]
          p_operation_key: string
        }
        Returns: Json
      }
      reorder_schedule_wbs_sections: {
        Args: {
          p_ordered_ids: string[]
          p_parent_id: string
          p_project_id: string
        }
        Returns: number
      }
      replace_subcontract_payment_allocations_atomic: {
        Args: { p_payment_id: string; p_rows?: Json }
        Returns: Json
      }
      reserve_auth_magic_link_send: {
        Args: {
          p_dedupe_key: string
          p_message_id: string
          p_metadata?: Json
          p_recipient_email: string
          p_template_name: string
        }
        Returns: {
          created_at: string
          id: string
          message_id: string
          reserved: boolean
          status: string
        }[]
      }
      role_preset_capabilities: {
        Args: { p_role: Database["public"]["Enums"]["account_role"] }
        Returns: Json
      }
      save_ai_symbol_library_example: {
        Args: {
          p_accepted_count: number
          p_ai_operation_id: string
          p_cost_library_item_id: string
          p_embedding: Json
          p_estimate_id: string
          p_exemplar_storage_path: string
          p_label: string
          p_plan_sheet_id: string
          p_rejected_count: number
          p_source_point: Json
          p_trade: string
          p_unit: string
        }
        Returns: {
          example_id: string
          library_item_id: string
        }[]
      }
      save_daily_wip_entry_atomic: {
        Args: {
          p_entry_id: string
          p_expected_version: number
          p_operation_key: string
          p_payload: Json
          p_project_id: string
        }
        Returns: Json
      }
      save_estimate_plan_revision_decisions: {
        Args: { p_decisions: Json; p_revision_plan_set_id: string }
        Returns: {
          ai_operation_id: string | null
          base_sheet_id: string | null
          confidence: number
          created_at: string
          estimate_id: string
          evidence: Json
          id: string
          proposal_method: string
          reason: string
          review_action: string
          reviewed_at: string
          reviewed_by: string | null
          revision_plan_set_id: string
          revision_sheet_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "estimate_plan_revision_matches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_estimate_plan_revision_impact_review: {
        Args: {
          p_disposition: string
          p_impacts: Json
          p_revision_match_id: string
          p_summary_notes: string
        }
        Returns: {
          base_sheet_id: string
          created_at: string
          disposition: string
          estimate_id: string
          id: string
          impacts: Json
          reviewed_at: string
          reviewed_by: string | null
          revision_match_id: string
          revision_sheet_id: string
          summary_notes: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "estimate_plan_revision_impact_reviews"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_estimate_scope_brief_review: {
        Args: {
          p_ai_operation_id: string
          p_item_id: string
          p_next_action: string
          p_review_notes: string
          p_status: string
        }
        Returns: {
          ai_operation_id: string
          created_at: string
          estimate_id: string
          id: string
          item_id: string
          next_action: string
          plan_set_id: string
          plan_sheet_id: string
          review_kind: string
          review_notes: string
          reviewed_at: string
          reviewed_by: string | null
          scope_label: string
          source_excerpt: string
          source_line: string
          status: string
          trade: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "estimate_scope_brief_reviews"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_estimate_takeoff_assembly: {
        Args: {
          p_ai_operation_id: string
          p_inputs: Json
          p_status: string
          p_takeoff_measurement_id: string
          p_template_id: string
        }
        Returns: {
          ai_operation_id: string | null
          ai_proposals: Json
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_inputs: Json
          created_at: string
          created_by: string | null
          derived_outputs: Json
          estimate_id: string
          formula_version: string
          geometry_calculation_scale_revision: number | null
          geometry_quantity: number
          geometry_unit: string
          id: string
          source_citations: Json
          status: string
          takeoff_measurement_id: string
          template_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "estimate_takeoff_assemblies"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_subcontract_atomic: {
        Args: {
          p_expected_updated_at: string
          p_operation_key: string
          p_patch: Json
          p_project_id: string
          p_subcontract_id: string
        }
        Returns: Json
      }
      seed_project_award_contingency: {
        Args: { p_contract: number; p_pct?: number; p_project_id: string }
        Returns: undefined
      }
      shares_org_with: { Args: { target_user: string }; Returns: boolean }
      storage_estimate_id: { Args: { p_name: string }; Returns: string }
      storage_organization_id: { Args: { p_name: string }; Returns: string }
      storage_project_id: { Args: { p_name: string }; Returns: string }
      sync_billing_application_from_lines: {
        Args: { p_billing_application_id: string }
        Returns: undefined
      }
      sync_estimate_takeoff_quantity_atomic: {
        Args: {
          p_estimate_id: string
          p_expected_updated_at: string
          p_line_item_id: string
          p_operation_key: string
          p_quantity: number
          p_takeoff_unit: string
        }
        Returns: Json
      }
      takeoff_unit_family: { Args: { p_unit: string }; Returns: string }
      transition_billing_application_atomic: {
        Args: {
          p_billing_application_id: string
          p_idempotency_key: string
          p_reason: string
          p_to_status: string
        }
        Returns: Json
      }
      transition_billing_invoice_atomic: {
        Args: {
          p_billing_invoice_id: string
          p_expected_updated_at: string
          p_idempotency_key: string
          p_reason: string
          p_sent_recipients: Json
          p_to_status: string
        }
        Returns: Json
      }
      transition_cost_actual_atomic: {
        Args: {
          p_cost_actual_id: string
          p_idempotency_key: string
          p_payment_details: Json
          p_target_status: string
        }
        Returns: Json
      }
      transition_subcontract_payment_atomic: {
        Args: {
          p_override_reason?: string
          p_paid_date?: string
          p_payment_id: string
          p_payment_method?: string
          p_payment_reference?: string
          p_status: string
        }
        Returns: Json
      }
      unlink_change_order_exposure_atomic: {
        Args: { p_change_order_id: string; p_exposure_id: string }
        Returns: Json
      }
      unlink_estimate_takeoff_assembly_output: {
        Args: { p_assembly_id: string; p_output_key: string }
        Returns: string
      }
      update_billing_application_atomic: {
        Args: {
          p_billing_application_id: string
          p_idempotency_key: string
          p_patch: Json
        }
        Returns: Json
      }
      update_billing_application_retainage_atomic: {
        Args: { p_billing_application_id: string; p_retainage_pct: number }
        Returns: Json
      }
      update_billing_invoice_atomic: {
        Args: {
          p_billing_invoice_id: string
          p_expected_updated_at: string
          p_idempotency_key: string
          p_patch: Json
        }
        Returns: Json
      }
      update_billing_invoice_processor_state_atomic: {
        Args: {
          p_billing_invoice_id: string
          p_checkout_session_id?: string
          p_idempotency_key?: string
          p_online_payment_status: string
          p_payment_enabled?: boolean
          p_payment_intent_id?: string
          p_payment_link_sent_at?: string
          p_payment_url?: string
        }
        Returns: Json
      }
      update_change_order_atomic: {
        Args: {
          p_change_order_id: string
          p_co_type: string
          p_contract_amount_cents: number
          p_cost_amount_cents: number
          p_date_initiated: string
          p_description: string
          p_expected_updated_at: string
          p_financial_direction: string
          p_notes: string
          p_number: string
          p_operation_key: string
          p_owner: string
          p_pricing_method: string
          p_probability: number
          p_project_id: string
          p_requested_by: string
          p_schedule_impact_days: number
          p_status: string
        }
        Returns: Json
      }
      update_cost_actual_atomic: {
        Args: {
          p_cost_actual_id: string
          p_idempotency_key: string
          p_payload: Json
        }
        Returns: Json
      }
      update_cost_bucket_atomic: {
        Args: {
          p_bucket_id: string
          p_note?: string
          p_operation_key: string
          p_patch: Json
        }
        Returns: Json
      }
      update_estimate_header_atomic: {
        Args: { p_estimate_id: string; p_operation_key: string; p_patch: Json }
        Returns: Json
      }
      update_estimate_line_item_atomic: {
        Args: { p_line_item_id: string; p_operation_key: string; p_patch: Json }
        Returns: Json
      }
      update_exposure_allocation_atomic: {
        Args: {
          p_allocation_id: string
          p_amount_cents: number
          p_cost_bucket_id: string
          p_expected_version: number
          p_operation_key: string
        }
        Returns: Json
      }
      update_organization_membership_authority: {
        Args: {
          p_capabilities?: Json
          p_membership_id: string
          p_role?: Database["public"]["Enums"]["account_role"]
          p_status?: Database["public"]["Enums"]["member_status"]
        }
        Returns: {
          capabilities: Json
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
        SetofOptions: {
          from: "*"
          to: "organization_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_project_financial_header_atomic: {
        Args: {
          p_expected_updated_at: string
          p_operation_key: string
          p_override_reason: string
          p_patch: Json
          p_project_id: string
        }
        Returns: Json
      }
      update_subcontract_payment_draft_atomic: {
        Args: {
          p_expected_updated_at: string
          p_operation_key: string
          p_patch: Json
          p_payment_id: string
        }
        Returns: Json
      }
      user_is_active_org_member: {
        Args: { p_org: string; p_user: string }
        Returns: boolean
      }
      void_cost_actual_atomic: {
        Args: {
          p_cost_actual_id: string
          p_idempotency_key: string
          p_notes: string
        }
        Returns: Json
      }
      void_daily_wip_entry_atomic: {
        Args: {
          p_entry_id: string
          p_expected_version: number
          p_operation_key: string
          p_project_id: string
          p_reason: string
        }
        Returns: Json
      }
      void_invoice_payment_atomic: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: Json
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
      stripe_mode: "test" | "live"
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
      stripe_mode: ["test", "live"],
    },
  },
} as const
