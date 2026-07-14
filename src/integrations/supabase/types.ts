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
      billing_invoices: {
        Row: {
          billing_application_id: string | null
          client_visible: boolean
          collections_log: string
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
          project_id: string
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
          project_id: string
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
          project_id?: string
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
          approved_at: string | null
          approved_by: string | null
          category: string
          cost_bucket_id: string | null
          cost_code: string
          cost_date: string
          created_at: string
          created_by: string | null
          credit_applies_to_id: string | null
          daily_wip_offset: number
          description: string
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
          updated_at: string
          vendor: string
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          cost_bucket_id?: string | null
          cost_code?: string
          cost_date: string
          created_at?: string
          created_by?: string | null
          credit_applies_to_id?: string | null
          daily_wip_offset?: number
          description: string
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
          updated_at?: string
          vendor?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          cost_bucket_id?: string | null
          cost_code?: string
          cost_date?: string
          created_at?: string
          created_by?: string | null
          credit_applies_to_id?: string | null
          daily_wip_offset?: number
          description?: string
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
          external_id: string
          id: string
          keywords: Json
          labor_basis: string
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
          labor_basis?: string
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
          labor_basis?: string
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
          equipment_items: Json
          field_percent_complete: number
          hours: number
          id: string
          labor_rate: number
          material_cost: number
          material_items: Json
          notes: string
          percent_basis: string
          percent_complete: number
          percent_overridden_at: string | null
          project_id: string
          quantity: number
          quantity_items: Json
          schedule_activity_id: string | null
          subcontractor_id: string | null
          unit: string
          unmatched_vendor_name: string
          updated_at: string
        }
        Insert: {
          activity?: string
          cost_bucket_id?: string | null
          created_at?: string
          created_by?: string | null
          crew_count?: number
          entry_date: string
          equipment_cost?: number
          equipment_items?: Json
          field_percent_complete?: number
          hours?: number
          id?: string
          labor_rate?: number
          material_cost?: number
          material_items?: Json
          notes?: string
          percent_basis?: string
          percent_complete?: number
          percent_overridden_at?: string | null
          project_id: string
          quantity?: number
          quantity_items?: Json
          schedule_activity_id?: string | null
          subcontractor_id?: string | null
          unit?: string
          unmatched_vendor_name?: string
          updated_at?: string
        }
        Update: {
          activity?: string
          cost_bucket_id?: string | null
          created_at?: string
          created_by?: string | null
          crew_count?: number
          entry_date?: string
          equipment_cost?: number
          equipment_items?: Json
          field_percent_complete?: number
          hours?: number
          id?: string
          labor_rate?: number
          material_cost?: number
          material_items?: Json
          notes?: string
          percent_basis?: string
          percent_complete?: number
          percent_overridden_at?: string | null
          project_id?: string
          quantity?: number
          quantity_items?: Json
          schedule_activity_id?: string | null
          subcontractor_id?: string | null
          unit?: string
          unmatched_vendor_name?: string
          updated_at?: string
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
          scale_feet_per_pixel?: number
          scale_label?: string
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
          scale_feet_per_pixel?: number
          scale_label?: string
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
      estimate_takeoff_measurements: {
        Row: {
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
          created_by_ai?: boolean
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
          created_by_ai?: boolean
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
          contingency_pct?: number
          created_at?: string
          created_by?: string | null
          custom_markups?: Json
          description?: string
          folder?: string
          general_conditions_pct?: number
          id?: string
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
          contingency_pct?: number
          created_at?: string
          created_by?: string | null
          custom_markups?: Json
          description?: string
          folder?: string
          general_conditions_pct?: number
          id?: string
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
          billing_status: string
          city: string
          contractor_circle_grant: boolean
          country: string
          created_at: string
          created_by: string | null
          daily_report_limit_per_month: number
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
          stripe_connect_status: string
          stripe_customer_id: string
          stripe_mode: Database["public"]["Enums"]["stripe_mode"]
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
          billing_status?: string
          city?: string
          contractor_circle_grant?: boolean
          country?: string
          created_at?: string
          created_by?: string | null
          daily_report_limit_per_month?: number
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
          stripe_connect_status?: string
          stripe_customer_id?: string
          stripe_mode?: Database["public"]["Enums"]["stripe_mode"]
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
          billing_status?: string
          city?: string
          contractor_circle_grant?: boolean
          country?: string
          created_at?: string
          created_by?: string | null
          daily_report_limit_per_month?: number
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
          stripe_connect_status?: string
          stripe_customer_id?: string
          stripe_mode?: Database["public"]["Enums"]["stripe_mode"]
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
          id: string
          invoice_id: string
          net_payout: number
          notes: string
          organization_id: string | null
          overwatch_fee: number
          paid_at: string
          payment_method: string
          processor: string
          processor_fee: number
          processor_payment_id: string
          project_id: string
          receipt_url: string
          reference: string
          status: string
          stripe_charge_id: string
          stripe_checkout_session_id: string
          stripe_payment_intent_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          amount_cents?: number
          billing_application_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id: string
          net_payout?: number
          notes?: string
          organization_id?: string | null
          overwatch_fee?: number
          paid_at?: string
          payment_method?: string
          processor?: string
          processor_fee?: number
          processor_payment_id?: string
          project_id: string
          receipt_url?: string
          reference?: string
          status?: string
          stripe_charge_id?: string
          stripe_checkout_session_id?: string
          stripe_payment_intent_id?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_cents?: number
          billing_application_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id?: string
          net_payout?: number
          notes?: string
          organization_id?: string | null
          overwatch_fee?: number
          paid_at?: string
          payment_method?: string
          processor?: string
          processor_fee?: number
          processor_payment_id?: string
          project_id?: string
          receipt_url?: string
          reference?: string
          status?: string
          stripe_charge_id?: string
          stripe_checkout_session_id?: string
          stripe_payment_intent_id?: string
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
          owner_name: string
          priority: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          action_type?: string
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
          owner_name?: string
          priority?: string
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          action_type?: string
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
          owner_name?: string
          priority?: string
          title?: string
          updated_at?: string
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
          id: string
          need_on_site_date: string | null
          order_by_date: string | null
          procurement_lead_days: number
          procurement_status: string
          project_id: string
          room_area: string
          schedule_activity_id: string | null
          schedule_override_acknowledged: boolean
          selected_option_id: string | null
          selection_number: string
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
          id?: string
          need_on_site_date?: string | null
          order_by_date?: string | null
          procurement_lead_days?: number
          procurement_status?: string
          project_id: string
          room_area?: string
          schedule_activity_id?: string | null
          schedule_override_acknowledged?: boolean
          selected_option_id?: string | null
          selection_number?: string
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
          id?: string
          need_on_site_date?: string | null
          order_by_date?: string | null
          procurement_lead_days?: number
          procurement_status?: string
          project_id?: string
          room_area?: string
          schedule_activity_id?: string | null
          schedule_override_acknowledged?: boolean
          selected_option_id?: string | null
          selection_number?: string
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
          original_cost_budget: number
          profile: string
          project_id: string
          raw_rows: number
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
          original_cost_budget?: number
          profile?: string
          project_id: string
          raw_rows?: number
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
          original_cost_budget?: number
          profile?: string
          project_id?: string
          raw_rows?: number
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
      stripe_webhook_events: {
        Row: {
          claimed_at: string
          event_id: string
          event_type: string
          processed_at: string
          status: string
        }
        Insert: {
          claimed_at?: string
          event_id: string
          event_type?: string
          processed_at?: string
          status?: string
        }
        Update: {
          claimed_at?: string
          event_id?: string
          event_type?: string
          processed_at?: string
          status?: string
        }
        Relationships: []
      }
      subcontract_allocations: {
        Row: {
          amount: number
          cost_bucket_id: string | null
          cost_code: string
          created_at: string
          description: string
          id: string
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
          project_id?: string
          subcontract_id?: string
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
      subcontract_change_orders: {
        Row: {
          amount: number
          co_date: string
          cost_bucket_id: string | null
          cost_code: string
          created_at: string
          description: string
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
      subcontract_payments: {
        Row: {
          amount: number
          approved_at: string | null
          compliance_overridden_at: string | null
          compliance_overridden_by: string | null
          compliance_override_reason: string
          created_at: string
          id: string
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
          id?: string
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
          id?: string
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
      can_approve_client_change_order: {
        Args: { p_change_order_id: string }
        Returns: boolean
      }
      can_create_project_in_org: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      can_manage_estimate: { Args: { p_estimate_id: string }; Returns: boolean }
      can_manage_org: { Args: { p_org_id: string }; Returns: boolean }
      can_manage_project: { Args: { p_project_id: string }; Returns: boolean }
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
      convert_pipeline_opportunity_to_project: {
        Args: { p_opportunity_id: string }
        Returns: string
      }
      cost_actual_rollup_amount: {
        Args: { p_amount: number; p_status: string }
        Returns: number
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
      has_org_capability: {
        Args: { p_capability: string; p_org_id: string }
        Returns: boolean
      }
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
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
      overwatch_access_email_key: { Args: { p_email: string }; Returns: string }
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
      reorder_schedule_wbs_sections: {
        Args: {
          p_ordered_ids: string[]
          p_parent_id: string
          p_project_id: string
        }
        Returns: number
      }
      role_preset_capabilities: {
        Args: { p_role: Database["public"]["Enums"]["account_role"] }
        Returns: Json
      }
      seed_project_award_contingency: {
        Args: { p_contract: number; p_pct?: number; p_project_id: string }
        Returns: undefined
      }
      storage_estimate_id: { Args: { p_name: string }; Returns: string }
      storage_organization_id: { Args: { p_name: string }; Returns: string }
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
