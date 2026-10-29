#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Edge {
    pub power: f64,
    pub pace: f64,
    pub reserves: f64,
    pub mend: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Works {
    pub defence: f64,
    pub loss: f64,
    pub per_day: f64,
    pub most: f64,
    pub assault: f64,
}

pub const ADRIFT_DAYS: f64 = 2.0;
pub const ANCHOR_FREE_KM: f64 = 75.0;
pub const ARMOUR_SHARE_BY_ERA: [f64; 4] = [0.15, 0.15, 0.1, 0.3];
pub const ARTILLERY_SHARE_BY_ERA: [f64; 4] = [0.1, 0.1, 0.15, 0.15];
pub const ASSAULT_BASE: f64 = 4.0;
pub const ASSAULT_DAYS: f64 = 20.0;
pub const ASSAULT_DEFENDERS_KM: f64 = 25.0;
pub const ASSAULT_FROM_KM: f64 = 280.0;
pub const ASSAULT_LEAST: f64 = 6.0;
pub const ASSAULT_MOST: f64 = 24.0;
pub const ASSAULT_PER_STRENGTH: f64 = 70.0;
pub const ASSAULT_RING_KM: [f64; 2] = [3.0, 11.0];
pub const ASSAULT_WEAR: f64 = 2.5;
pub const ATTACK_COST: f64 = 1.5;
pub const ATTACK_LAPSE_DAYS: f64 = 120.0;
pub const ATTRITION: f64 = 0.6;
pub const ATTRITION_DUG: f64 = 0.6;
pub const ATTRITION_HARSH_FROM: f64 = 0.8;
pub const ATTRITION_RATIO_MAX: f64 = 3.0;
pub const ATTRITION_RATIO_MIN: f64 = 0.3;
pub const ATTRITION_SHORT: f64 = 1.0;
pub const ATTRITION_TIRED: f64 = 1.0;
pub const ATTRITION_WEATHER: f64 = 0.25;
pub const BAND_CELLS: f64 = 3.0;
pub const BAND_UNITS: f64 = 32.0;
pub const BATTLEFIELD_NAME_MAX: f64 = 80.0;
pub const BATTLEFIELD_STATUSES: [&str; 4] = ["active", "frozen", "closed", "standing"];
pub const BATTLEFIELD_VERSION: f64 = 1.0;
pub const BLITZ_BREADTH: f64 = 0.5;
pub const BLITZ_MASS_DAYS: f64 = 4.0;
pub const BLITZ_PACE: f64 = 1.3;
pub const BREAKTHROUGH_COUNTER_ODDS: f64 = 0.8;
pub const BREAKTHROUGH_ENCLOSED: f64 = 5.0;
pub const BREAKTHROUGH_KM: f64 = 80.0;
pub const BREAKTHROUGH_LOOK_DAYS: f64 = 3.0;
pub const BREAKTHROUGH_LOSS: f64 = 0.5;
pub const BREAKTHROUGH_ODDS_KM: f64 = 50.0;
pub const BREAKTHROUGH_RING_KM: f64 = 40.0;
pub const BREAK_OUT_DAYS: f64 = 4.0;
pub const BREAK_OUT_KM: f64 = 55.0;
pub const BREAK_OUT_REST_DAYS: f64 = 7.0;
pub const BRIEF_TEXT_MAX: f64 = 700.0;
pub const CAPTOR_WITHIN_KM: f64 = 150.0;
pub const CAPTURED_CITY_CELLS: f64 = 2.0;
pub const CAPTURED_COLUMN: f64 = 3.0;
pub const CAPTURED_LOSS: f64 = 0.3;
pub const CELL_STEPS_KM: [f64; 10] = [4.0, 6.0, 8.0, 12.0, 16.0, 24.0, 32.0, 48.0, 64.0, 96.0];
pub const CLOSE_APART_COS: [f64; 14] = [0.309, 0.5878, 0.729, 0.809, 0.8584, 0.891, 0.9135, 0.9298, 0.9418, 0.9511, 0.9582, 0.964, 0.9686, 0.9724];
pub const CLOSE_DAYS_MOST: f64 = 10.0;
pub const CLOSE_FAR_KM: [f64; 2] = [150.0, 80.0];
pub const CLOSE_GIVEN_UP_DAYS: f64 = 6.0;
pub const CLOSE_LEAST: f64 = 3.0;
pub const CLOSE_LEAVES_KM: [f64; 2] = [160.0, 90.0];
pub const CLOSE_MOST: f64 = 16.0;
pub const CLOSE_NEAR_KM: [f64; 2] = [60.0, 35.0];
pub const CLOSE_REST_DAYS: f64 = 3.0;
pub const CLOSE_RIM_KM: f64 = 22.0;
pub const CLOSE_STRENGTH: f64 = 160.0;
pub const CLOSE_UNDER_STRENGTH: f64 = 30.0;
pub const CLOSE_WEAR: f64 = 1.8;
pub const CLOSE_WORN: f64 = 24.0;
pub const COLLAPSE_LEFT: f64 = 0.2;
pub const COLUMN_BREADTH_KM: f64 = 28.0;
pub const COME_UP_FROM: f64 = 3.5;
pub const COME_UP_KM: f64 = 7.0;
pub const COME_UP_TO: f64 = 2.0;
pub const COMMAND_TROOPS: [f64; 4] = [12.0, 40.0, 110.0, 220.0];
pub const COMPASS_16: [f64; 32] = [1.0, 0.0, 0.9238795325112867, 0.3826834323650898, 0.7071067811865476, 0.7071067811865476, 0.3826834323650898, 0.9238795325112867, 0.0, 1.0, -0.3826834323650898, 0.9238795325112867, -0.7071067811865476, 0.7071067811865476, -0.9238795325112867, 0.3826834323650898, -1.0, 0.0, -0.9238795325112867, -0.3826834323650898, -0.7071067811865476, -0.7071067811865476, -0.3826834323650898, -0.9238795325112867, 0.0, -1.0, 0.3826834323650898, -0.9238795325112867, 0.7071067811865476, -0.7071067811865476, 0.9238795325112867, -0.3826834323650898];
pub const CONTACT_WITHIN_KM: f64 = 400.0;
pub const CONTROL_RADIUS_MAX_KM: f64 = 16.0;
pub const CONTROL_RADIUS_MIN_CELLS: f64 = 0.9;
pub const CONTROL_RADIUS_MIN_KM: f64 = 6.0;
pub const CONTROL_RADIUS_OF_SPACING: f64 = 0.9;
pub const CORRIDOR_COST: f64 = 4.0;
pub const CORRIDOR_KM: f64 = 20.0;
pub const DEEP_KM: f64 = 80.0;
pub const DEFAULT_EFFORT: &str = "major";
pub const DEFAULT_ORDER: &str = "hold";
pub const DIFFICULTY_EDGES: [(&str, Edge); 6] = [
    ("very-easy", Edge { power: 0.85, pace: 0.9, reserves: 0.7, mend: 0.75 }),
    ("easy", Edge { power: 0.93, pace: 0.95, reserves: 0.85, mend: 0.9 }),
    ("medium", Edge { power: 1.0, pace: 1.0, reserves: 1.0, mend: 1.0 }),
    ("hard", Edge { power: 1.15, pace: 1.1, reserves: 1.3, mend: 1.25 }),
    ("very-hard", Edge { power: 1.35, pace: 1.2, reserves: 1.75, mend: 1.6 }),
    ("impossible", Edge { power: 1.75, pace: 1.4, reserves: 3.0, mend: 2.5 }),
];
pub const DIG_LOST_KM: f64 = 2.0;
pub const DIG_MAX_HOLD: f64 = 0.5;
pub const DIG_PER_DAY_HOLD: f64 = 0.04;
pub const DRIFT_DAYS: f64 = 5.0;
pub const DUG_IN_DEFENCE: f64 = 1.6;
pub const DUG_IN_LOSS: f64 = 0.55;
pub const EASE_KM: f64 = 2.5;
pub const EASE_SHARE: f64 = 0.2;
pub const EDIT_MARGIN_CELLS: f64 = 2.0;
pub const EFFORT_FACTORS: [(&str, f64); 4] = [("token", 0.3), ("limited", 0.6), ("major", 1.0), ("total", 1.4)];
pub const EMPTY_POCKET_KM2: f64 = 6000.0;
pub const FALL_BACK_FROM_KM: f64 = 50.0;
pub const FALL_BACK_KM_PER_DAY: f64 = 15.0;
pub const FALL_BACK_MAX_KM: f64 = 150.0;
pub const FALL_BACK_PACE_KM: f64 = 26.0;
pub const FALL_BACK_SEARCH_KM: f64 = 52.0;
pub const FAR_CELLS: f64 = 8.0;
pub const FATIGUE_ATTACK: f64 = 0.035;
pub const FATIGUE_DEFEND: f64 = 0.015;
pub const FATIGUE_EXHAUSTED: f64 = 0.7;
pub const FATIGUE_GUARD: f64 = 0.15;
pub const FATIGUE_LEGS: f64 = 0.4;
pub const FATIGUE_MARCH: f64 = 0.05;
pub const FATIGUE_PUNCH: f64 = 0.35;
pub const FATIGUE_REST: f64 = 0.07;
pub const FATIGUE_REST_DUG: f64 = 1.25;
pub const FATIGUE_REST_POCKET: f64 = 0.25;
pub const FATIGUE_STILL_KM: f64 = 2.0;
pub const FLANKED_DEFENCE: f64 = 0.75;
pub const FLANK_BEHIND_COS: f64 = -0.2;
pub const FLANK_OPPOSITE_COS: f64 = -0.7;
pub const FLIP_AT: f64 = 0.6;
pub const FOOT_REACH_CELLS: f64 = 6.0;
pub const FRAME_MARGIN_KM: f64 = 100.0;
pub const FRONT_COMMANDS_MOST: f64 = 5.0;
pub const FRONT_EFFORTS: [&str; 4] = ["token", "limited", "major", "total"];
pub const FRONT_ORDERS: [&str; 11] = ["advance", "blitz", "spearhead", "encircle", "hold", "dig in", "fall back", "withdraw", "land", "flank", "assault"];
pub const FRONT_PACE_SHARE: f64 = 0.4;
pub const FRONT_RESULTS: [&str; 6] = ["breakthrough", "captured", "repulsed", "stalemate", "collapse", "surrender"];
pub const GAIN: f64 = 0.9;
pub const GAVE_GROUND_REST_DAYS: f64 = 5.0;
pub const GENERAL_NAME_MAX: f64 = 60.0;
pub const GIVES_UP_UNDER: f64 = 14.0;
pub const GRIP_KM: f64 = 16.0;
pub const GROUP_BREADTH_BRUSHES: f64 = 1.5;
pub const GROUP_BREADTH_MIN_KM: f64 = 40.0;
pub const GROUP_BREADTH_OF_EXTENT: f64 = 1.2;
pub const GROW_KM: f64 = 250.0;
pub const GROW_WITHIN_CELLS: f64 = 6.0;
pub const HALT_DAYS: f64 = 14.0;
pub const HAND_OVER_REACH_CELLS: f64 = 8.0;
pub const HAND_STALL_DAYS: f64 = 6.0;
pub const HAND_STALL_KM: f64 = 4.0;
pub const HEADING_KEPT: f64 = 0.7;
pub const HEADING_KEPT_CLOSING: f64 = 0.5;
pub const HOLDER_SIDE_A: f64 = 0.0;
pub const HOLDER_SIDE_B: f64 = 1.0;
pub const HOLDER_WALL: f64 = 2.0;
pub const HOLD_BACK_TO: f64 = 1.1;
pub const HOLD_TOO_NEAR: f64 = 0.45;
pub const ICE_SPEED: f64 = 0.35;
pub const INVADE_REACH_KM: f64 = 18.0;
pub const LANDING_CELLS: f64 = 2.0;
pub const LANDING_TROOPS: f64 = 4.0;
pub const LANE_GAP_MIN: f64 = 0.35;
pub const LINE_MARKS: [&str; 2] = ["staff", "scenario"];
pub const LINE_MOVED: f64 = 1.0;
pub const LINE_PUSHED_BY_A: f64 = 2.0;
pub const LINE_PUSHED_BY_B: f64 = 3.0;
pub const LINE_QUIET: f64 = 0.0;
pub const LINE_SIMPLIFY_CELLS: f64 = 0.04;
pub const LINE_UNITS: f64 = 32.0;
pub const LOG_TEXT_MAX: f64 = 160.0;
pub const MANPOWER_SHARE: f64 = 0.12;
pub const MARK_MAX: f64 = 170.0;
pub const MAX_BATTLEFIELDS: f64 = 12.0;
pub const MAX_BATTLEFIELDS_CHARS: f64 = 160000.0;
pub const MAX_CELLS: f64 = 64000.0;
pub const MAX_CLOSED_BATTLEFIELDS: f64 = 4.0;
pub const MAX_COMMANDS: f64 = 8.0;
pub const MAX_CONTESTED_REGIONS: f64 = 160.0;
pub const MAX_FRAMES: f64 = 5.0;
pub const MAX_GRID_SPAN: f64 = 255.0;
pub const MAX_LOG_ENTRIES: f64 = 12.0;
pub const MAX_NAMED_TROOPS: f64 = 64.0;
pub const MAX_ORDERS_PER_SIDE: f64 = 16.0;
pub const MAX_ORDER_ATTACKS: f64 = 4.0;
pub const MAX_PLANS_PER_SIDE: f64 = 12.0;
pub const MAX_SIDE_MEMBERS: f64 = 8.0;
pub const MAX_TALK_LINES: f64 = 40.0;
pub const MAX_TROOPS_PER_SIDE: f64 = 400.0;
pub const MAX_WAY_POINTS: f64 = 12.0;
pub const MEN_PER_FORMATION_BY_ERA: [f64; 4] = [2000.0, 5000.0, 12000.0, 10000.0];
pub const MIND_MARK: &str = "mind";
pub const MIN_DAYS_BETWEEN_FLIPS: f64 = 3.0;
pub const MUSTER_STANDING_SHARE: f64 = 0.25;
pub const NAMED_WITHIN_KM: f64 = 250.0;
pub const OBJECTIVE_BEYOND_KM: f64 = 1500.0;
pub const OBJECTIVE_GROWS_MOST: f64 = 8.0;
pub const OUTFLANKED_FROM_KM: f64 = 16.0;
pub const OUTFLANKED_NARROW: f64 = 0.75;
pub const OUTFLANKED_NECK_KM: f64 = 12.0;
pub const OUTWARD_KM: f64 = 100.0;
pub const OUT_AHEAD_KM: f64 = 50.0;
pub const OVERRUN_CELLS: f64 = 6.0;
pub const OVERRUN_ESCAPE_KM: f64 = 60.0;
pub const OVERRUN_LOSS: f64 = 10.0;
pub const OVERRUN_ODDS: f64 = 4.0;
pub const OVERRUN_WITHIN_KM: f64 = 14.0;
pub const PART_COUNTER_LEAST: f64 = 0.1;
pub const PATCH_MAX_KM2: f64 = 1500.0;
pub const PLACE_SECTOR_KM: f64 = 60.0;
pub const PLAN_PLACE_KM: f64 = 70.0;
pub const PLAN_REACH_KM: f64 = 110.0;
pub const PLAN_STANDOFF_KM: f64 = 38.0;
pub const POCKET_ATTACK: f64 = 0.7;
pub const POCKET_DAYS: f64 = 10.0;
pub const POCKET_DEFENCE: f64 = 0.75;
pub const POCKET_LOSS: f64 = 2.0;
pub const POINT_BREADTH: f64 = 0.75;
pub const POINT_STOPS_SHORT: f64 = 0.3;
pub const POOL_PER_TROOP: f64 = 30.0;
pub const QUALITY_MAX: f64 = 1.5;
pub const QUALITY_MIN: f64 = 0.5;
pub const QUIET_ATTRITION: f64 = 0.1;
pub const RANK_BAND_KM: f64 = 16.0;
pub const RANK_KM: f64 = 100.0;
pub const RANK_LEAST: f64 = 0.2;
pub const RANK_SLACK_KM: f64 = 8.0;
pub const RATIO_NEEDED: f64 = 1.15;
pub const RATIO_SOFTNESS: f64 = 2.0;
pub const REACH_KM: f64 = 40.0;
pub const REACH_MIN_CELLS: f64 = 4.0;
pub const REDISTANCE_NEAR_CELLS: f64 = 2.0;
pub const REDISTANCE_REACH_CELLS: f64 = 4.0;
pub const REINFORCED_LINE_MOST: f64 = 2.0;
pub const REINFORCED_SIZE_MOST: f64 = 3.0;
pub const REINFORCE_MOST: f64 = 60.0;
pub const REINFORCE_ORDER: &str = "reinforce";
pub const REINFORCE_PER_DAY: f64 = 1.0;
pub const REINFORCE_USUAL_SHARE: f64 = 0.25;
pub const REPAINT_BELOW: f64 = 0.4;
pub const REPULSED_LOSS: f64 = 0.25;
pub const RESERVES_AMPLE_PER_TROOP: f64 = 15.0;
pub const ROOM_BRUSHES: f64 = 1.25;
pub const ROUND_KM: f64 = 34.0;
pub const ROUTE_BREADTH_BRUSHES: f64 = 1.1;
pub const ROUTE_BREADTH_MIN_KM: f64 = 24.0;
pub const ROUTE_INTO_KM: f64 = 30.0;
pub const ROUTE_JOIN_KM: f64 = 20.0;
pub const ROUTE_SET_OFF_DAYS: f64 = 3.0;
pub const ROUTE_STOPS_SHORT_KM: f64 = 45.0;
pub const ROUTE_STOPS_SHORT_MOST: f64 = 0.6;
pub const SCENARIO_MARK: &str = "scenario";
pub const SCRAP_KM2: f64 = 400.0;
pub const SECTOR_AXIS_SHARE: f64 = 0.35;
pub const SHORTAGE_EDGE: Edge = Edge { power: 0.15, pace: 0.15, reserves: 0.5, mend: 0.5 };
pub const SHOULDER_OUT: f64 = 0.3;
pub const SHOULDER_OUT_KM: [f64; 2] = [8.0, 30.0];
pub const SHOULDER_STOPS: [f64; 2] = [0.25, 0.9];
pub const SIEGE_DAYS: f64 = 45.0;
pub const SIEGE_LOSS: f64 = 1.0;
pub const SIEGE_SPARE_KM: f64 = 20.0;
pub const SLIDE_BAND: [f64; 2] = [0.8, 3.5];
pub const SLIDE_FAR_KM: f64 = 75.0;
pub const SLIDE_HEARS_KM: f64 = 110.0;
pub const SLIDE_KM: f64 = 6.0;
pub const SLIDE_LEAST_DEPTH: f64 = 0.7;
pub const SLIDE_NEAR_KM: f64 = 30.0;
pub const SLOT_SLIDE_KM: f64 = 30.0;
pub const SLOT_SLIDE_MOST: f64 = 0.7;
pub const SPEARHEAD_BREADTH_KM: f64 = 70.0;
pub const SPREAD_KM: f64 = 24.0;
pub const SPREAD_KM_PER_DAY: f64 = 5.0;
pub const SQUEEZED_LOSS: f64 = 1.0;
pub const SQUEEZED_MIN_KM2: f64 = 300.0;
pub const SQUEEZED_NEAR: f64 = 0.15;
pub const SQUEEZED_NEAR_KM: f64 = 24.0;
pub const SQUEEZED_TAKEN: f64 = 0.5;
pub const STAFF_ATTACKER_ADVANCES: f64 = 1.25;
pub const STAFF_ATTACKER_PROBES: f64 = 0.9;
pub const STAFF_CHANCE_ATTACKER: f64 = 0.7;
pub const STAFF_CHANCE_DEFENDER: f64 = 0.5;
pub const STAFF_DEFENDER_ADVANCES: f64 = 1.5;
pub const STAFF_DEFENDER_PROBES: f64 = 1.15;
pub const STAFF_DIGS_IN_UNDER: f64 = 0.55;
pub const STAFF_MARK: &str = "staff";
pub const STAFF_REVIEW_DAYS: f64 = 10.0;
pub const STAFF_SECTOR_TROOPS_LEAST: f64 = 3.0;
pub const STAFF_STORY_ORDER_DAYS: f64 = 45.0;
pub const STANDING_QUIET_DAYS: f64 = 30.0;
pub const STAND_OFF_KM: [f64; 3] = [8.0, 8.0, 16.0];
pub const STEER_DRIFT: f64 = 0.15;
pub const STEER_PRESS: f64 = 0.3;
pub const STEER_PRESS_KM: f64 = 35.0;
pub const STILL_EDGE: f64 = 0.08;
pub const STORY_TAKERS_MOST: f64 = 8.0;
pub const STORY_TAKER_KM2: f64 = 4000.0;
pub const STORY_TAKER_REACH_KM: f64 = 150.0;
pub const STRAIGHT_BACK_FURTHER: f64 = 1.6;
pub const STRANDED_DAYS: f64 = 2.0;
pub const STRAND_KM: f64 = 40.0;
pub const STRONG_WORKS: Works = Works { defence: 2.5, loss: 0.35, per_day: 0.06, most: 0.7, assault: 2.5 };
pub const SUBSTEPS_MAX: f64 = 32.0;
pub const SUPERSAMPLE: f64 = 4.0;
pub const SUPPLY_EVERY_DAYS: f64 = 3.0;
pub const SUPPLY_FAR_FACTOR: f64 = 2.5;
pub const SUPPLY_FULL_KM: [f64; 4] = [120.0, 180.0, 300.0, 450.0];
pub const SUPPLY_LEAST: f64 = 0.4;
pub const SUPPORT_FULL: f64 = 0.3;
pub const SUPPORT_KM: f64 = 100.0;
pub const SUPPORT_NONE: f64 = 0.1;
pub const SURROUNDED_DEFENCE: f64 = 0.55;
pub const SWARM_JOIN_KM: f64 = 60.0;
pub const SWARM_PLACE_KM: f64 = 40.0;
pub const SWARM_REAR_KM: f64 = 30.0;
pub const SWARM_SPACING_BRUSHES: f64 = 0.9;
pub const SWARM_TROOPS_EACH: f64 = 24.0;
pub const TALK_TEXT_MAX: f64 = 700.0;
pub const TERRAIN_DEFENCE_GAIN: f64 = 1.25;
pub const TERRAIN_SPEED_MAX: f64 = 2.0;
pub const TERRAIN_SPEED_MIN: f64 = 0.2;
pub const THAW_LOSS: f64 = 0.3;
pub const THAW_REACH_CELLS: f64 = 12.0;
pub const THROWN_OUT_LOSS: f64 = 15.0;
pub const THRUST_LEAST: f64 = 4.0;
pub const THRUST_LINK_KM: f64 = 60.0;
pub const THRUST_SHARE: f64 = 0.6;
pub const THRUST_TROOPS: [(&str, f64); 5] = [("spearhead", 44.0), ("encircle", 32.0), ("flank", 16.0), ("advance", 36.0), ("blitz", 36.0)];
pub const TRAIT_DEPTH: [f64; 2] = [0.4, 1.8];
pub const TRAIT_DRIVE: [f64; 2] = [0.7, 1.35];
pub const TRAIT_LAG_DAYS: [f64; 5] = [0.0, 0.0, 1.0, 1.0, 2.0];
pub const TRAIT_LANE: [f64; 2] = [-0.45, 0.45];
pub const TROOPS_FACTOR_LEAST: f64 = 0.25;
pub const TROOPS_FACTOR_MOST: f64 = 4.0;
pub const TROOPS_LINE_KM_EACH: f64 = 3.0;
pub const TROOPS_MIN: f64 = 3.0;
pub const TROOPS_PER_STRENGTH: f64 = 6.0;
pub const TROOP_ATTACK: [f64; 3] = [1.0, 1.6, 1.2];
pub const TROOP_DEFENCE: [f64; 3] = [1.2, 1.0, 0.8];
pub const TROOP_KINDS: [&str; 3] = ["infantry", "armor", "artillery"];
pub const TROOP_STATES: [&str; 5] = ["holding", "advancing", "encircled", "spent", "dug in"];
pub const TROOP_UNITS: f64 = 16.0;
pub const TURNS: [f64; 8] = [0.8660254037844387, 0.5, 0.8660254037844387, -0.5, 0.5, 0.8660254037844387, 0.5, -0.8660254037844387];
pub const TURN_CLOSING: f64 = 0.7071067811865476;
pub const TURN_COS: f64 = 0.8660254037844387;
pub const TURN_SIN: f64 = 0.5;
pub const WAR_EFFORTS: [&str; 2] = ["major", "total"];
pub const WAR_ROOM_ORDERS: [&str; 9] = ["advance", "blitz", "spearhead", "flank", "encircle", "hold", "dig in", "fall back", "withdraw"];
pub const WAR_ROOM_STANCES: [&str; 3] = ["accepts", "objects", "speaks"];
pub const WATCH_KM: f64 = 45.0;
pub const WATCH_SHARE: f64 = 0.3;
pub const WATCH_TROOPS_MOST: f64 = 28.0;
pub const WAY_BEND_CELLS: f64 = 3.0;
pub const WAY_DAYS_MIN: f64 = 10.0;
pub const WAY_LEAST: f64 = 0.2;
pub const WAY_LEGS_MAX: f64 = 3.0;
pub const WHOLE_AT: f64 = 0.95;
pub const WITHDRAW_DAYS_MOST: f64 = 12.0;
pub const WITHDRAW_KM: f64 = 60.0;
pub const WORKS: Works = Works { defence: 1.6, loss: 0.55, per_day: 0.04, most: 0.5, assault: 1.0 };

pub fn lookup(table: &[(&str, f64)], key: &str) -> Option<f64> {
    table.iter().find(|(name, _)| *name == key).map(|(_, value)| *value)
}

pub fn edge_of(key: &str) -> Option<Edge> {
    DIFFICULTY_EDGES.iter().find(|(name, _)| *name == key).map(|(_, edge)| *edge)
}

pub struct Takers {
    pub least: f64,
    pub most: f64,
}

pub fn takers_for(area_km2: f64) -> Takers {
    let area = if area_km2 > 0.0 { area_km2 } else { 0.0 };
    let most = crate::jsmath::min(STORY_TAKERS_MOST, crate::jsmath::max(1.0, (area / STORY_TAKER_KM2).ceil()));
    Takers { least: crate::jsmath::max(1.0, (most / 3.0).ceil()), most }
}
