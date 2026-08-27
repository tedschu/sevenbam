export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      league_members: {
        Row: {
          joined_at: string
          league_id: string
          profile_id: string
          role: string
          role_ack_at: string | null
          role_changed_at: string | null
        }
        Insert: {
          joined_at?: string
          league_id: string
          profile_id: string
          role?: string
          role_ack_at?: string | null
          role_changed_at?: string | null
        }
        Update: {
          joined_at?: string
          league_id?: string
          profile_id?: string
          role?: string
          role_ack_at?: string | null
          role_changed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "league_members_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "league_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "league_standings"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "league_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      league_sessions: {
        Row: {
          created_at: string
          date_time: string
          id: string
          latitude: number | null
          location: string
          location_detail: string | null
          longitude: number | null
          season_id: string
          sequence: number
        }
        Insert: {
          created_at?: string
          date_time: string
          id?: string
          latitude?: number | null
          location: string
          location_detail?: string | null
          longitude?: number | null
          season_id: string
          sequence: number
        }
        Update: {
          created_at?: string
          date_time?: string
          id?: string
          latitude?: number | null
          location?: string
          location_detail?: string | null
          longitude?: number | null
          season_id?: string
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "league_sessions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          archived_at: string | null
          color: string
          created_at: string
          created_by: string
          id: string
          invite_token: string
          is_public: boolean
          max_members: number | null
          name: string
        }
        Insert: {
          archived_at?: string | null
          color?: string
          created_at?: string
          created_by: string
          id?: string
          invite_token?: string
          is_public?: boolean
          max_members?: number | null
          name: string
        }
        Update: {
          archived_at?: string | null
          color?: string
          created_at?: string
          created_by?: string
          id?: string
          invite_token?: string
          is_public?: boolean
          max_members?: number | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "leagues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "leagues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "league_standings"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "leagues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_players: {
        Row: {
          joined_at: string
          match_id: string
          player_id: string
          score: number | null
        }
        Insert: {
          joined_at?: string
          match_id: string
          player_id: string
          score?: number | null
        }
        Update: {
          joined_at?: string
          match_id?: string
          player_id?: string
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "match_players_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "match_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "league_standings"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "match_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          created_at: string
          date_time: string
          host_id: string
          id: string
          latitude: number | null
          league_id: string | null
          location: string
          location_detail: string | null
          longitude: number | null
          needs_sub: boolean
          notes: string | null
          session_id: string | null
          status: string | null
          supplies_provided: boolean | null
          table_number: number | null
        }
        Insert: {
          created_at?: string
          date_time: string
          host_id: string
          id?: string
          latitude?: number | null
          league_id?: string | null
          location: string
          location_detail?: string | null
          longitude?: number | null
          needs_sub?: boolean
          notes?: string | null
          session_id?: string | null
          status?: string | null
          supplies_provided?: boolean | null
          table_number?: number | null
        }
        Update: {
          created_at?: string
          date_time?: string
          host_id?: string
          id?: string
          latitude?: number | null
          league_id?: string | null
          location?: string
          location_detail?: string | null
          longitude?: number | null
          needs_sub?: boolean
          notes?: string | null
          session_id?: string | null
          status?: string | null
          supplies_provided?: boolean | null
          table_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "matches_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "league_standings"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "matches_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "league_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_attendance_summary"
            referencedColumns: ["session_id"]
          },
        ]
      }
      profile_contacts: {
        Row: {
          phone: string | null
          profile_id: string
        }
        Insert: {
          phone?: string | null
          profile_id: string
        }
        Update: {
          phone?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_contacts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "profile_contacts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "league_standings"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "profile_contacts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          deleted_at: string | null
          experience_level: string | null
          home_latitude: number | null
          home_longitude: number | null
          id: string
          name: string | null
          town: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          experience_level?: string | null
          home_latitude?: number | null
          home_longitude?: number | null
          id: string
          name?: string | null
          town?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          experience_level?: string | null
          home_latitude?: number | null
          home_longitude?: number | null
          id?: string
          name?: string | null
          town?: string | null
        }
        Relationships: []
      }
      seasons: {
        Row: {
          created_at: string
          id: string
          league_id: string
          name: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          name: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      session_attendance: {
        Row: {
          profile_id: string
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          profile_id: string
          session_id: string
          status: string
          updated_at?: string
        }
        Update: {
          profile_id?: string
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_attendance_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "session_attendance_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "league_standings"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "session_attendance_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "league_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_attendance_summary"
            referencedColumns: ["session_id"]
          },
        ]
      }
    }
    Views: {
      leaderboard: {
        Row: {
          avatar_url: string | null
          average_placement: number | null
          average_points: number | null
          deleted: boolean | null
          games_played: number | null
          name: string | null
          player_id: string | null
          total_points: number | null
          wins: number | null
        }
        Relationships: []
      }
      league_standings: {
        Row: {
          avatar_url: string | null
          average_placement: number | null
          average_points: number | null
          deleted: boolean | null
          games_played: number | null
          league_id: string | null
          name: string | null
          player_id: string | null
          total_points: number | null
          wins: number | null
        }
        Relationships: [
          {
            foreignKeyName: "league_members_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      session_attendance_summary: {
        Row: {
          confirmed: number | null
          expected_tables: number | null
          going: number | null
          no_answer: number | null
          not_going: number | null
          roster: number | null
          session_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acknowledge_league_role_change: {
        Args: { p_league: string }
        Returns: undefined
      }
      anonymous_player_name: { Args: { p_profile_id: string }; Returns: string }
      delete_league: { Args: { p_league_id: string }; Returns: undefined }
      delete_my_account: { Args: never; Returns: undefined }
      draw_league_session: { Args: { p_session_id: string }; Returns: number }
      enter_match_scores: {
        Args: { p_match_id: string; p_scores: Json }
        Returns: undefined
      }
      is_league_member: { Args: { p_league: string }; Returns: boolean }
      is_league_organizer: { Args: { p_league: string }; Returns: boolean }
      join_league_with_token: { Args: { p_token: string }; Returns: string }
      join_public_league: { Args: { p_league_id: string }; Returns: string }
      league_member_contacts: {
        Args: { p_league_id: string }
        Returns: {
          email: string
          name: string
        }[]
      }
      league_organizer_contact: {
        Args: { p_league_id: string }
        Returns: {
          email: string
          name: string
          phone: string
        }[]
      }
      match_host_contact: {
        Args: { p_match_id: string }
        Returns: {
          email: string
          name: string
          phone: string
        }[]
      }
      match_player_contacts: {
        Args: { p_match_id: string }
        Returns: {
          email: string
          name: string
        }[]
      }
      match_seat_limit: { Args: never; Returns: number }
      new_invite_token: { Args: never; Returns: string }
      open_session_to_subs: {
        Args: { p_open: boolean; p_session_id: string }
        Returns: number
      }
      public_leagues: {
        Args: never
        Returns: {
          color: string
          created_at: string
          id: string
          is_member: boolean
          max_members: number
          member_count: number
          name: string
          next_latitude: number
          next_location: string
          next_location_detail: string
          next_longitude: number
          next_meetup: string
          seats_left: number
        }[]
      }
      set_session_attendance: {
        Args: { p_session_id: string; p_status: string }
        Returns: number
      }
      update_league_session: {
        Args: {
          p_date_time: string
          p_latitude: number
          p_location: string
          p_location_detail: string
          p_longitude: number
          p_session_id: string
        }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

