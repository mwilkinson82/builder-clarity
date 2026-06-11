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
      change_orders: {
        Row: {
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
      cost_buckets: {
        Row: {
          actual_to_date: number
          bucket: string
          created_at: string
          ftc: number
          id: string
          original_budget: number
          project_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          actual_to_date?: number
          bucket: string
          created_at?: string
          ftc?: number
          id?: string
          original_budget?: number
          project_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          actual_to_date?: number
          bucket?: string
          created_at?: string
          ftc?: number
          id?: string
          original_budget?: number
          project_id?: string
          sort_order?: number
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
      projects: {
        Row: {
          baseline_completion_date: string | null
          client: string
          created_at: string
          forecast_completion_date: string | null
          hold_variance_note: string
          id: string
          last_review_summary: string
          last_reviewed_at: string | null
          name: string
          next_review_at: string | null
          original_contract: number
          original_cost_budget: number
          owner_id: string
          percent_complete: number
          phase: Database["public"]["Enums"]["project_phase"]
          schedule_variance_weeks: number
          updated_at: string
        }
        Insert: {
          baseline_completion_date?: string | null
          client?: string
          created_at?: string
          forecast_completion_date?: string | null
          hold_variance_note?: string
          id?: string
          last_review_summary?: string
          last_reviewed_at?: string | null
          name: string
          next_review_at?: string | null
          original_contract?: number
          original_cost_budget?: number
          owner_id: string
          percent_complete?: number
          phase?: Database["public"]["Enums"]["project_phase"]
          schedule_variance_weeks?: number
          updated_at?: string
        }
        Update: {
          baseline_completion_date?: string | null
          client?: string
          created_at?: string
          forecast_completion_date?: string | null
          hold_variance_note?: string
          id?: string
          last_review_summary?: string
          last_reviewed_at?: string | null
          name?: string
          next_review_at?: string | null
          original_contract?: number
          original_cost_budget?: number
          owner_id?: string
          percent_complete?: number
          phase?: Database["public"]["Enums"]["project_phase"]
          schedule_variance_weeks?: number
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          created_at: string
          forecast_completion_date_after: string | null
          forecast_completion_date_before: string | null
          id: string
          project_id: string
          reviewed_at: string
          reviewer: string
          rollup_snapshot: Json
          summary_notes: string
        }
        Insert: {
          created_at?: string
          forecast_completion_date_after?: string | null
          forecast_completion_date_before?: string | null
          id?: string
          project_id: string
          reviewed_at?: string
          reviewer?: string
          rollup_snapshot?: Json
          summary_notes?: string
        }
        Update: {
          created_at?: string
          forecast_completion_date_after?: string | null
          forecast_completion_date_before?: string | null
          id?: string
          project_id?: string
          reviewed_at?: string
          reviewer?: string
          rollup_snapshot?: Json
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
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
      project_phase: ["Early", "Middle", "Late"],
      response_path: ["eliminate", "recover", "offset", "accept"],
    },
  },
} as const
