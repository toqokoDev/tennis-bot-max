export type SportType =
  | '🎾Большой теннис'
  | '🏓Настольный теннис'
  | '🏸Бадминтон'
  | '🏖️Пляжный теннис'
  | '🎾Падл-теннис'
  | '🥎Сквош'
  | '🏆Пиклбол'
  | '⛳Гольф'
  | '🏃‍♂️‍➡️Бег'
  | '🏋️‍♀️Фитнес'
  | '🚴Вело'
  | '☕️Бизнес-завтрак'
  | '🍻По пиву'
  | '🍒Знакомства';

export type SportCategory = 'court_sport' | 'outdoor_sport' | 'meeting' | 'dating';

export type UserRole = '🎯 Игрок' | '👨‍🏫 Тренер';
export type Gender = 'Мужской' | 'Женский';

export interface SubscriptionInfo {
  active: boolean;
  until: string;
  expired?: boolean;
  last_expired_notification?: string;
}

export interface PendingPayment {
  payment_id: string;
  email: string;
  payment_link?: string;
  provider?: 'tinkoff' | 'yookassa';
  created_at: string;
}

export interface GameOffer {
  id: number;
  sport: SportType;
  country: string;
  city: string;
  district?: string;
  date: string;
  time: string;
  game_type?: string;
  payment_type?: string;
  competitive?: boolean;
  comment?: string;
  active: boolean;
  dating_goal?: string;
  dating_interests?: string[];
  dating_additional?: string;
  created_at: string;
}

export interface UserProfile {
  max_user_id: number;
  username?: string;
  first_name: string;
  last_name: string;
  phone: string;
  birth_date: string;
  country: string;
  city: string;
  district?: string;
  role: UserRole;
  sport: SportType;
  gender: Gender;
  player_level?: string;
  rating_points: number;
  rating_edited?: boolean;
  price?: number;
  photo_path?: string;
  games_played: number;
  games_wins: number;
  default_payment?: string;
  show_in_search: boolean;
  profile_comment?: string;
  referrals_invited: number;
  free_offers_used: number;
  games: GameOffer[];
  subscription?: SubscriptionInfo;
  pending_payment?: PendingPayment;
  created_at: string;
  web_user_id?: string;
  web_domain?: string;
  vacation_tennis?: boolean;
  vacation_start?: string;
  vacation_end?: string;
  vacation_country?: string;
  vacation_city?: string;
  vacation_district?: string;
  vacation_comment?: string;
  dating_goal?: string;
  dating_goal_key?: string;
  dating_interests?: string[];
  dating_interests_keys?: string[];
  dating_additional?: string;
  meeting_time?: string;
  offer_responses?: OfferResponse[];
}

export interface OfferResponse {
  from_user_id: number;
  from_name: string;
  game_id: number;
  comment: string;
  status: 'new' | 'read';
  response_date: string;
}

export interface BannedUser {
  reason: string;
  banned_at: string;
}

export interface ParticipantInfo {
  user_id: number;
  name: string;
  paid?: boolean;
  joined_at: string;
}

export type TournamentStatus = 'active' | 'started' | 'finished' | 'cancelled';
export type TournamentType = 'Олимпийская система' | 'Круговая';

export interface Tournament {
  id: string;
  name: string;
  sport: SportType;
  country: string;
  city: string;
  district?: string;
  type: TournamentType;
  gender?: string;
  category: string;
  level: string;
  age_group: 'Взрослые' | 'Дети';
  duration: string;
  participants_count: number;
  participants: Record<string, ParticipantInfo>;
  show_in_list: boolean;
  hide_bracket: boolean;
  comment?: string;
  status: TournamentStatus;
  entry_fee: number;
  payments: Record<string, {
    status: 'pending' | 'succeeded';
    payment_id: string;
    provider?: 'tinkoff' | 'yookassa';
    payment_link?: string;
  }>;
  payment_window?: { active: boolean; deadline_at: string; created_at: string };
  bracket?: Record<string, unknown>;
  round_robin?: Record<string, unknown>;
  created_by: string;
  created_at: string;
}

export interface TournamentApplication {
  id: string;
  tournament_id: string;
  user_id: number;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface RatingUpdate {
  before: number;
  after: number;
}

export interface CompletedGame {
  id: string;
  sport: SportType;
  game_type: 'single' | 'double' | 'tournament';
  players: number[];
  sets: string[];
  winner_ids: number[];
  tournament_id?: string;
  media_path?: string;
  rating_updates?: Record<string, RatingUpdate>;
  created_at: string;
  created_by: number;
}

export interface UserSession {
  state?: string;
  data: Record<string, unknown>;
  prev_msg_id?: string;
  referral_id?: number;
}
