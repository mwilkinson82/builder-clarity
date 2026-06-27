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
          id: string
          invoice_number: string
          notes: string
          paid_to_date: number
          project_id: string
          retainage: number
          sort_order: number
          status: string
          submitted_date: string | null
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
          id?: string
          invoice_number?: string
          notes?: string
          paid_to_date?: number
          project_id: string
          retainage?: number
          sort_order?: number
          status?: string
          submitted_date?: string | null
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
          id?: string
          invoice_number?: string
          notes?: string
          paid_to_date?: number
          project_id?: string
          retainage?: number
          sort_order?: number
          status?: string
          submitted_date?: string | null
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
      cost_buckets: {
        Row: {
          actual_to_date: number
          bucket: string
          cost_code: string
          created_at: string
          ftc: number
          id: string
          original_budget: number
          project_id: string
          sort_order: number
          source_date: string | null
          source_note: string
          source_type: string
          updated_at: string
        }
        Insert: {
          actual_to_date?: number
          bucket: string
          cost_code?: string
          created_at?: string
          ftc?: number
          id?: string
          original_budget?: number
          project_id: string
          sort_order?: number
          source_date?: string | null
          source_note?: string
          source_type?: string
          updated_at?: string
        }
        Update: {
          actual_to_date?: number
          bucket?: string
          cost_code?: string
          created_at?: string
          ftc?: number
          id?: string
          original_budget?: number
          project_id?: string
          sort_order?: number
          source_date?: string | null
          source_note?: string
          source_type?: string
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
          project_id: string
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
          project_id: string
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
          project_id?: string
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
          client: string
          created_at: string
          forecast_completion_date: string | null
          hold_variance_note: string
          id: string
          job_number: string
          last_review_summary: string
          last_reviewed_at: string | null
          name: string
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
          client?: string
          created_at?: string
          forecast_completion_date?: string | null
          hold_variance_note?: string
          id?: string
          job_number?: string
          last_review_summary?: string
          last_reviewed_at?: string | null
          name: string
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
          client?: string
          created_at?: string
          forecast_completion_date?: string | null
          hold_variance_note?: string
          id?: string
          job_number?: string
          last_review_summary?: string
          last_reviewed_at?: string | null
          name?: string
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
        }
        Relationships: [
          {
            foreignKeyName: "schedule_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
          forecast_completion_date: string
          id: string
          movement_weeks: number
          notes: string
          project_id: string
          update_date: string
          update_number: number
          updated_at: string
          variance_weeks: number
        }
        Insert: {
          baseline_completion_date?: string | null
          created_at?: string
          created_by?: string | null
          forecast_completion_date: string
          id?: string
          movement_weeks?: number
          notes?: string
          project_id: string
          update_date?: string
          update_number: number
          updated_at?: string
          variance_weeks?: number
        }
        Update: {
          baseline_completion_date?: string | null
          created_at?: string
          created_by?: string | null
          forecast_completion_date?: string
          id?: string
          movement_weeks?: number
          notes?: string
          project_id?: string
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
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
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
      storage_project_id: { Args: { p_name: string }; Returns: string }
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
