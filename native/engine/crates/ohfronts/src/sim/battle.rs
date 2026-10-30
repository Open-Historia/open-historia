use super::air::BattleWings;
use super::arena::Arena;
use super::chronicle::Chronicle;
use super::closing::{Books, Pocket};
use super::climate::{ZoneToday, ZoneWeights};
use super::constants::{Edge, Works, CONTROL_RADIUS_MAX_KM, DEFAULT_EFFORT};
use super::deploy::DeployLine;
use super::engine::Run;
use super::field::{Claims, Field};
use super::frame::{Frame, Projector};
use super::ground::ToSide;
use super::handicap::FAIR_EDGE;
use super::constants::REPAINT_BELOW;
use super::field::{redistance, set_ground, take_cells, trace_contour, Painter};
use super::handicap::{handicap_of, short_edge, side_shortage};
use super::js::{self, OrdMap, Val};
use super::line::{draw_line, measure_line};
use super::military::land_worth;
use super::muster::levy_pending;
use super::supply::nearest_of;
use super::troops::{live_count, side_radius_km};
use crate::jsmath;
use super::movement::Retreat;
use super::muster::Levy;
use super::orders::{HaltToday, OrderView};
use super::troops::Troop;
use super::walls::Walls;
use super::weather::Sky;
use super::command::Talk;
use super::replay::ReplayRecorder;
use super::chronicle::{chronicle_after, read_chronicle};
use super::codec::{decode_levels, decode_troops, encode_levels, encode_lines, encode_mask, encode_troops, Strand, TroopCode};
use super::command::{read_generals, read_talk, talk_val};
use super::constants::{BATTLEFIELD_VERSION, FAR_CELLS, HAND_STALL_DAYS, HOLDER_SIDE_A, HOLDER_SIDE_B, LINE_MARKS, MAX_COMMANDS, MAX_CONTESTED_REGIONS, MAX_LOG_ENTRIES, MAX_NAMED_TROOPS, MAX_TROOPS_PER_SIDE, NAMED_WITHIN_KM, POOL_PER_TROOP, REDISTANCE_REACH_CELLS, THAW_LOSS, THAW_REACH_CELLS, TROOP_UNITS};
use super::deploy::{has_lines, line_val, read_deploy};
use super::field::{nearest_held, nearest_on_contour, open_field, own_cell, pack_field, unpack_field, Contour};
use super::game_dates::{add_game_days, diff_game_days};
use super::ground::{away_of, cell_at, downhill, measure};
use super::manpower::{draw, formations_left_with, men_of, part_left_with, side_formations_left_with};
use super::military::mix_of;
use super::movement::place_behind;
use super::muster::{head_start_of, levy_owed, muster_share, musters_for, read_levy, spread_pick};
use super::orders::standing_of;
use super::record::{chronicle_record, frame_from, frame_record};
use super::replay::Finished;
use super::sectors::Sectors;
use super::scenario_fronts::{authored_forms, authored_troops};
use super::swarms::{raise_swarms, read_swarms, swarms_kept, SWARM_FORM};
use super::troops::{create_troop, draw_traits, drop_the_dead, is_attack, is_live, kinds_for, plan_lanes, share_out, size_sides, stand_at_places, stand_off, stands, troops_least, TroopSeed, KIND_ARMOUR, KIND_ARTILLERY, KIND_INFANTRY};
use super::way::{left_on_leg, Leg};
use super::weather::{skies_ahead, FORECAST_DAYS};
use super::js::Obj;
use std::cell::RefCell;
use std::sync::Arc as Rc;

#[derive(Clone, Debug, PartialEq)]
pub struct Named {
    pub s: usize,
    pub i: usize,
    pub name: String,
    pub unit_id: Val,
    pub reported: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Tally {
    pub by_owner: OrdMap<usize, f64>,
}

impl Tally {
    pub fn add(&mut self, owner: usize, value: f64) {
        let known = self.by_owner.get(&owner).copied();
        self.by_owner.set(owner, known.unwrap_or(0.0) + value);
    }
}

#[derive(Clone, Debug)]
pub struct Battle {
    pub name: String,
    pub war_id: Val,
    pub status: String,
    pub sides: [Vec<String>; 2],
    pub gone: [Vec<usize>; 2],
    pub opened_date: Val,
    pub opened_day: Val,
    pub frame: Frame,
    pub arena: Rc<Arena>,
    pub place: Projector,
    pub field: Option<Field>,
    pub region_side: Option<Vec<i8>>,
    pub home_side: Option<Vec<i8>>,
    pub shown: OrdMap<String, Val>,
    pub said: Vec<Val>,
    pub troops: [Vec<Troop>; 2],
    pub named: Vec<Named>,
    pub pool: [f64; 2],
    pub mended_by: [Vec<Option<f64>>; 2],
    pub base: [f64; 2],
    pub quality: [f64; 2],
    pub edge: [Edge; 2],
    pub effort: [String; 2],
    pub orders: Vec<Val>,
    pub orders_changed: f64,
    pub halts: Vec<Val>,
    pub levy: [Vec<Levy>; 2],
    pub halts_today: Vec<HaltToday>,
    pub views: [Vec<OrderView>; 2],
    pub plans: Val,
    pub deploy: Option<[Vec<DeployLine>; 2]>,
    pub plan_key: String,
    pub pockets: Vec<Pocket>,
    pub pocket_of: Option<[Vec<i32>; 2]>,
    pub pocket_turns: f64,
    pub close: Option<Books>,
    pub taken_for: bool,
    pub taken_turns: Option<i64>,
    pub taken_cells: f64,
    pub to_side: Option<ToSide>,
    pub fed: Option<[Vec<u8>; 2]>,
    pub body_of: Option<[Vec<i32>; 2]>,
    pub drawn_homes: Option<Vec<u8>>,
    pub sectors: Option<Rc<Sectors>>,
    pub sectors_for: Option<Rc<Contour>>,
    pub grown: f64,
    pub within: f64,
    pub within_for: Option<Rc<Arena>>,
    pub recorded: f64,
    pub served: bool,
    pub generals: [Vec<String>; 2],
    pub swarms: [Vec<usize>; 2],
    pub talk: [Vec<Talk>; 2],
    pub away: [bool; 2],
    pub sent_home: OrdMap<String, Val>,
    pub quiet: f64,
    pub leaving: [bool; 2],
    pub swap: bool,
    pub sieges: Vec<Val>,
    pub spared: [Vec<f64>; 2],
    pub siege_key: String,
    pub kept: [Option<Vec<u8>>; 2],
    pub supplied: [Option<Vec<u8>>; 2],
    pub supply: Option<[Vec<f32>; 2]>,
    pub home_pieces: [Option<Rc<HomePieces>>; 2],
    pub pocket_sieges: Option<String>,
    pub supply_turns: f64,
    pub anchors: Vec<Val>,
    pub log: Vec<Val>,
    pub log_from: f64,
    pub days_run: f64,
    pub claims: Claims,
    pub start_phi: Option<Vec<f64>>,
    pub start_holders: Option<Vec<u8>>,
    pub last_flip: Vec<i32>,
    pub settled_turns: f64,
    pub taken: [Vec<Val>; 2],
    pub cities_taken: [Vec<Val>; 2],
    pub city_holder: Option<Vec<i8>>,
    pub recorder: Option<ReplayRecorder>,
    pub replay: Option<Val>,
    pub staff_plans: Val,
    pub drawn: Val,
    pub drawn_flags: Val,
    pub drawn_contour: Val,
    pub closing: String,
    pub closed_date: String,
    pub line_km: f64,
    pub fresh: bool,
    pub auto_named: bool,
    pub seed: String,
    pub even: bool,
    pub radius_km: [f64; 2],
    pub watch: bool,
    pub homes: Option<Vec<u8>>,
    pub lost_by: Option<[Tally; 2]>,
    pub out_by: Option<[Tally; 2]>,
    pub harsh_by: Option<[Tally; 2]>,
    pub climate_lat: Option<f64>,
    pub climate_today: Option<Rc<Vec<ZoneToday>>>,
    pub sky: Option<Sky>,
    pub skies: Option<OrdMap<String, f64>>,
    pub zones_for: bool,
    pub zones: Option<Rc<Vec<ZoneWeights>>>,
    pub zones_day: Option<(String, f64)>,
    pub zones_mix: Option<Rc<Vec<ZoneToday>>>,
    pub walls_for: bool,
    pub wall_sides: String,
    pub walls: Option<Rc<Walls>>,
    pub wall_mask: [Option<Vec<u8>>; 2],
    pub wall_date: Option<String>,
    pub wall_run: bool,
    pub siege_kept: [Option<Vec<u8>>; 2],
    pub chronicle: Option<Chronicle>,
    pub air_mission: [String; 2],
    pub wings: Option<BattleWings>,
    pub mind_homes: RefCell<Option<Vec<i8>>>,
    pub worth: Option<[Vec<f64>; 2]>,
    pub short: Option<[f64; 2]>,
    pub works: Option<Works>,
    pub corridors: bool,
    pub exposure: Option<[f64; 2]>,
    pub mend_of: bool,
    pub look: Option<f64>,
    pub mind: Val,
    pub pace: f64,
    pub retreat: Option<Retreat>,
    pub ice_side: Option<Vec<i8>>,
    pub touched: bool,
    pub begun: bool,
    pub begun_by: Option<usize>,
    pub opened_for: bool,
    pub led_by_own: Option<[bool; 2]>,
    pub answering: Option<[f64; 2]>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HomePieces {
    pub size: usize,
    pub piece: Vec<i32>,
    pub count: usize,
}

pub struct Opening {
    pub name: String,
    pub war_id: Val,
    pub sides: [Vec<String>; 2],
    pub frame: Frame,
    pub arena: Rc<Arena>,
    pub opened_date: Val,
    pub opened_day: Val,
}

pub fn create_battle(run: &Run, opening: Opening) -> Battle {
    let Opening { name, war_id, sides, frame, arena, opened_date, opened_day } = opening;
    let size = arena.size;
    let regions = arena.ids.len();
    Battle {
        name,
        war_id,
        status: "active".to_string(),
        sides,
        gone: [Vec::new(), Vec::new()],
        opened_date,
        opened_day,
        place: Projector::of(&frame),
        frame,
        arena,
        field: None,
        region_side: None,
        home_side: None,
        shown: OrdMap::new(),
        said: Vec::new(),
        troops: [Vec::new(), Vec::new()],
        named: Vec::new(),
        pool: [0.0, 0.0],
        mended_by: [Vec::new(), Vec::new()],
        base: [0.0, 0.0],
        quality: [1.0, 1.0],
        edge: [FAIR_EDGE, FAIR_EDGE],
        effort: [DEFAULT_EFFORT.to_string(), DEFAULT_EFFORT.to_string()],
        orders: Vec::new(),
        orders_changed: 0.0,
        halts: Vec::new(),
        levy: [Vec::new(), Vec::new()],
        halts_today: Vec::new(),
        views: [Vec::new(), Vec::new()],
        plans: Val::Null,
        deploy: None,
        plan_key: String::new(),
        pockets: Vec::new(),
        pocket_of: None,
        pocket_turns: -1.0,
        close: None,
        taken_for: false,
        taken_turns: None,
        taken_cells: 0.0,
        to_side: None,
        fed: None,
        body_of: None,
        drawn_homes: None,
        sectors: None,
        sectors_for: None,
        grown: 0.0,
        within: 0.0,
        within_for: None,
        recorded: f64::NAN,
        served: false,
        generals: [Vec::new(), Vec::new()],
        swarms: [Vec::new(), Vec::new()],
        talk: [Vec::new(), Vec::new()],
        away: [false, false],
        sent_home: OrdMap::new(),
        quiet: 0.0,
        leaving: [false, false],
        swap: false,
        sieges: Vec::new(),
        spared: [Vec::new(), Vec::new()],
        siege_key: String::new(),
        kept: [None, None],
        supplied: [None, None],
        supply: None,
        home_pieces: [None, None],
        pocket_sieges: None,
        supply_turns: -1.0,
        anchors: Vec::new(),
        log: Vec::new(),
        log_from: 0.0,
        days_run: 0.0,
        claims: Claims { stamp: vec![0; size], power: vec![0.0; size], moment: 0.0 },
        start_phi: None,
        start_holders: None,
        last_flip: vec![-1000000; regions],
        settled_turns: -1.0,
        taken: [Vec::new(), Vec::new()],
        cities_taken: [Vec::new(), Vec::new()],
        city_holder: None,
        recorder: None,
        replay: None,
        staff_plans: Val::Null,
        drawn: Val::Null,
        drawn_flags: Val::Null,
        drawn_contour: Val::Null,
        closing: String::new(),
        closed_date: String::new(),
        line_km: 0.0,
        fresh: true,
        auto_named: false,
        seed: run.seed.clone(),
        even: run.steer.get("even").is_true(),
        radius_km: [CONTROL_RADIUS_MAX_KM, CONTROL_RADIUS_MAX_KM],
        watch: matches!(run.input.get("watch"), Val::Fn),
        homes: None,
        lost_by: None,
        out_by: None,
        harsh_by: None,
        climate_lat: None,
        climate_today: None,
        sky: None,
        skies: None,
        zones_for: false,
        zones: None,
        zones_day: None,
        zones_mix: None,
        walls_for: false,
        wall_sides: String::new(),
        walls: None,
        wall_mask: [None, None],
        wall_date: None,
        wall_run: false,
        siege_kept: [None, None],
        chronicle: None,
        air_mission: [String::new(), String::new()],
        wings: None,
        mind_homes: RefCell::new(None),
        worth: None,
        short: None,
        works: None,
        corridors: false,
        exposure: None,
        mend_of: false,
        look: None,
        mind: Val::Undef,
        pace: f64::NAN,
        retreat: None,
        ice_side: None,
        touched: false,
        begun: false,
        begun_by: None,
        opened_for: false,
        led_by_own: None,
        answering: None,
    }
}

pub fn keep_start(battle: &mut Battle) {
    if let Some(field) = &battle.field {
        battle.start_phi = Some(field.phi.clone());
        battle.start_holders = Some(field.holders.clone());
        battle.city_holder = Some(battle.arena.cities.iter().map(|city| field.holders[city.cell as usize] as i8).collect());
    }
}

fn fold_name(value: &str) -> String {
    js::fold_text(value)
}

pub fn side_of_name(battle: &Battle, name: &str) -> i64 {
    let wanted = fold_name(name);
    if wanted.is_empty() {
        return -1;
    }
    for side in 0..2 {
        if battle.sides[side].iter().enumerate().any(|(index, member)| fold_name(member) == wanted && !battle.gone[side].contains(&index)) {
            return side as i64;
        }
    }
    -1
}

pub fn holder_of(battle: &Battle, run: &Run, id: &str) -> String {
    let group = run.group_of(id);
    if !group.is_empty() && side_of_name(battle, &group) >= 0 {
        group
    } else {
        run.controller_of(id)
    }
}

pub fn read_regions(battle: &mut Battle, run: &Run) {
    let arena = battle.arena.clone();
    let count = arena.ids.len();
    let mut region_side = vec![-1i8; count];
    let mut home_side = vec![-1i8; count];
    for index in 1..count {
        let id = &arena.ids[index];
        let group = side_of_name(battle, &run.group_of(id));
        region_side[index] = if group >= 0 { group as i8 } else { side_of_name(battle, &run.controller_of(id)) as i8 };
        home_side[index] = if group >= 0 { group as i8 } else { side_of_name(battle, &run.sovereign_of(id)) as i8 };
        if !battle.shown.has(id) || region_side[index] < 0 {
            let holder = holder_of(battle, run, id);
            battle.shown.set(id.clone(), Val::Str(holder));
        }
    }
    let mut home_of_region = vec![2u8; count];
    for index in 1..count {
        let shown = battle.shown.get(&arena.ids[index]).map(|name| name.string_or_empty()).unwrap_or_default();
        let side = side_of_name(battle, &shown);
        if side >= 0 {
            home_of_region[index] = side as u8;
        }
    }
    battle.homes = Some(arena.region.iter().map(|&region| home_of_region[region as usize]).collect());
    battle.ice_side = ice_sides(&arena, &region_side);
    battle.region_side = Some(region_side);
    battle.home_side = Some(home_side);
    battle.home_pieces = [None, None];
}

pub fn ice_sides(arena: &Arena, region_side: &[i8]) -> Option<Vec<i8>> {
    let iced = arena.iced.as_ref()?;
    let (cols, rows) = (arena.cols, arena.rows);
    let mut side = vec![-1i8; arena.size];
    let mut queue: Vec<usize> = Vec::new();
    for cell in 0..arena.size {
        if iced[cell] == 1 || !(arena.speed[cell] > 0.0) {
            continue;
        }
        let own = region_side.get(arena.region[cell] as usize).copied().unwrap_or(-1);
        if own != 0 && own != 1 {
            continue;
        }
        side[cell] = own;
        queue.push(cell);
    }
    let mut at = 0;
    while at < queue.len() {
        let cell = queue[at];
        at += 1;
        let col = (cell % cols) as i64;
        let row = (cell / cols) as i64;
        for (dx, dy) in [(1i64, 0i64), (-1, 0), (0, 1), (0, -1)] {
            let (x, y) = (col + dx, row + dy);
            if x < 0 || y < 0 || x >= cols as i64 || y >= rows as i64 {
                continue;
            }
            let next = (y as usize) * cols + x as usize;
            if iced[next] != 1 || side[next] >= 0 {
                continue;
            }
            side[next] = side[cell];
            queue.push(next);
        }
    }
    Some(side)
}

pub fn read_region(battle: &mut Battle, run: &Run, id: &str) {
    let Some(&index) = battle.arena.index_of.get(id) else { return };
    if battle.region_side.is_none() {
        return;
    }
    let group = side_of_name(battle, &run.group_of(id));
    let side = if group >= 0 { group } else { side_of_name(battle, &run.controller_of(id)) };
    battle.region_side.as_mut().unwrap()[index] = side as i8;
    let home = if group >= 0 { group } else { side_of_name(battle, &run.sovereign_of(id)) };
    let known = battle.home_side.as_ref().and_then(|homes| homes.get(index).copied()).map(|value| value as i64);
    if known == Some(home) {
        return;
    }
    if let Some(homes) = battle.home_side.as_mut() {
        if index < homes.len() {
            homes[index] = home as i8;
        }
    }
    battle.home_pieces = [None, None];
}

pub fn member_index(battle: &Battle, side: usize, name: &str) -> i64 {
    let wanted = fold_name(name);
    if wanted.is_empty() {
        return -1;
    }
    battle.sides[side].iter().position(|member| fold_name(member) == wanted).map(|at| at as i64).unwrap_or(-1)
}

pub fn paint_ground(battle: &mut Battle, run: &Run) {
    let arena = battle.arena.clone();
    let regions = arena.ids.len();
    let mut shown_as = [vec![-1i64; regions], vec![-1i64; regions]];
    let mut holder = [vec![-1i64; regions], vec![-1i64; regions]];
    for region in 1..regions {
        let id = &arena.ids[region];
        let shown = battle.shown.get(id).map(|name| name.string_or_empty()).unwrap_or_default();
        for side in 0..2 {
            shown_as[side][region] = member_index(battle, side, &shown);
            let group = member_index(battle, side, &run.group_of(id));
            holder[side][region] = if group >= 0 { group } else { member_index(battle, side, &run.controller_of(id)) };
        }
    }
    let troops = battle.troops.clone();
    let homes = battle.homes.clone();
    let field = battle.field.as_mut().unwrap();
    for index in 0..field.size {
        let side = field.holders[index] as usize;
        if side != 0 && side != 1 {
            continue;
        }
        let region = arena.region[index] as usize;
        let home = homes.as_ref().and_then(|homes| homes.get(index).copied()).map(|home| home as usize);
        let known = if home == Some(side) { jsmath::max(0.0, shown_as[side][region] as f64) as i64 } else { holder[side][region] };
        field.painter[index] = if known >= 0 { known as u8 } else { nearest_of(&troops[side], field.cols, index) as u8 };
    }
}

pub fn set_handicap(battle: &mut Battle, run: &Run) {
    let sides: [Vec<Val>; 2] = [0, 1].map(|side| battle.sides[side].iter().enumerate().filter(|(at, _)| !battle.gone[side].contains(at)).map(|(_, member)| Val::Str(member.clone())).collect());
    let both = Val::Arr(sides.iter().map(|members| Val::Arr(members.clone())).collect());
    let edges = handicap_of(run.input.get("difficulty"), &both, run.input.get("players")).edges;
    let shortage = |member: &Val| run.shortage_of(&member.string_or_empty());
    let strength = |member: &Val| run.strength_of(&member.string_or_empty());
    let short = [0, 1].map(|side| side_shortage(&sides[side], Some(&shortage), Some(&strength)));
    battle.edge = [short_edge(edges[0], short[0]), short_edge(edges[1], short[1])];
    battle.short = Some(short);
    battle.worth = if run.mech.military() { Some([0, 1].map(|side| battle.sides[side].iter().map(|member| land_worth(&run.military_of(member))).collect())) } else { None };
}

pub fn line_length(battle: &mut Battle) -> f64 {
    let field = battle.field.as_mut().unwrap();
    let contour = trace_contour(field);
    battle.line_km = measure_line(field, &contour).measured.total;
    battle.line_km
}

pub fn set_radii(battle: &mut Battle) {
    line_length(battle);
    battle.radius_km = [0, 1].map(|side| side_radius_km(battle.line_km, live_count(&battle.troops[side]) as f64 + levy_pending(&battle.levy[side])));
    for side in 0..2 {
        let radius = battle.radius_km[side];
        for troop in battle.troops[side].iter_mut() {
            troop.radius_km = radius;
        }
    }
}

pub fn reconcile(battle: &mut Battle, run: &Run) -> bool {
    read_regions(battle, run);
    let arena = battle.arena.clone();
    let region_side: Vec<i32> = battle.region_side.as_ref().unwrap().iter().map(|&side| side as i32).collect();
    let ice: Option<Vec<i32>> = battle.ice_side.as_ref().map(|ice| ice.iter().map(|&side| side as i32).collect());
    let mut changed = set_ground(battle.field.as_mut().unwrap(), &region_side, ice.as_deref());
    let field = battle.field.as_ref().unwrap();
    let mut held = vec![0i32; arena.ids.len()];
    for index in 0..field.size {
        let region = arena.region[index] as usize;
        if field.play[index] != 0 && field.holders[index] as i32 == region_side[region] {
            held[region] += 1;
        }
    }
    let mut repaint = vec![false; arena.ids.len()];
    let mut any = false;
    for region in 1..arena.ids.len() {
        if region_side[region] < 0 || arena.region_speed[region] <= 0.0 {
            continue;
        }
        let whole = arena.cells[region] as f64 + arena.outside[region];
        if (held[region] as f64 + arena.outside[region]) / whole >= REPAINT_BELOW {
            continue;
        }
        repaint[region] = true;
        any = true;
    }
    if any {
        let mut cells: [Vec<usize>; 2] = [Vec::new(), Vec::new()];
        for index in 0..field.size {
            let region = arena.region[index] as usize;
            if field.play[index] != 0 && repaint[region] {
                cells[region_side[region] as usize].push(index);
            }
        }
        let troops = battle.troops.clone();
        let sides = battle.sides.clone();
        let cols = field.cols;
        for side in 0..2 {
            if cells[side].is_empty() {
                continue;
            }
            let mut painter = |index: usize| -> f64 {
                let id = &arena.ids[arena.region[index] as usize];
                let group = run.group_of(id);
                let name = if group.is_empty() { run.controller_of(id) } else { group };
                let wanted = fold_name(&name);
                let named = if wanted.is_empty() { -1 } else { sides[side].iter().position(|member| fold_name(member) == wanted).map(|at| at as i64).unwrap_or(-1) };
                if named >= 0 {
                    named as f64
                } else {
                    nearest_of(&troops[side], cols, index)
                }
            };
            take_cells(battle.field.as_mut().unwrap(), side as u8, &cells[side], Painter::By(&mut painter));
        }
        changed = true;
    }
    if changed {
        redistance(battle.field.as_mut().unwrap());
    }
    changed
}

pub fn member_weights(battle: &Battle, run: &Run, me: Option<usize>, side: usize) -> Vec<f64> {
    battle.sides[side]
        .iter()
        .enumerate()
        .map(|(index, member)| {
            if battle.gone[side].contains(&index) {
                return 0.0;
            }
            let mut elsewhere = 0.0;
            for (at, other) in run.battles.iter().enumerate() {
                if Some(at) != me && other.status != "closed" && side_of_name(other, member) >= 0 {
                    elsewhere += other.line_km;
                }
            }
            let share = if battle.line_km + elsewhere > 0.0 { battle.line_km / (battle.line_km + elsewhere) } else { 1.0 };
            jsmath::max(0.0, js::or_zero(run.strength_of(member))) * share
        })
        .collect()
}

fn round3(value: f64) -> f64 {
    jsmath::round(value * 1000.0) / 1000.0
}

fn sum_of(values: &[f64]) -> f64 {
    values.iter().fold(0.0, |sum, &value| sum + value)
}

fn sides_val(battle: &Battle) -> Val {
    Val::Arr(battle.sides.iter().map(|members| Val::Arr(members.iter().map(|member| Val::str(member)).collect())).collect())
}

fn settle_raised(battle: &mut Battle, side: usize, raised: &[usize]) {
    measure(battle.field.as_ref().unwrap(), &mut battle.to_side);
    let mut toward = [0.0f64; 2];
    for &index in raised {
        let depth = {
            let place = &battle.place;
            stand_off(&battle.troops[side][index], |y| place.km_at(y))
        };
        for _ in 0..6 {
            let (x, y) = (battle.troops[side][index].x, battle.troops[side][index].y);
            let field = battle.field.as_ref().unwrap();
            let on_own = stands(field, side as u8, x, y);
            let away = if on_own { away_of(field, battle.to_side.as_ref().unwrap(), side, x, y) } else { 0.0 };
            if !on_own || away < depth * 0.6 {
                let troop = battle.troops[side][index].clone();
                match place_behind(battle, side, &troop, depth) {
                    Some(behind) if !(behind[0] == x && behind[1] == y) => {
                        battle.troops[side][index].x = behind[0];
                        battle.troops[side][index].y = behind[1];
                    }
                    _ => break,
                }
            } else if away > depth * 3.0 && downhill(field, &battle.to_side.as_ref().unwrap().sides[1 - side], x, y, &mut toward) {
                let step = away - depth * 2.0;
                if !stands(field, side as u8, x + toward[0] * step, y + toward[1] * step) {
                    break;
                }
                let troop = &mut battle.troops[side][index];
                troop.x += toward[0] * step;
                troop.y += toward[1] * step;
            } else {
                break;
            }
        }
    }
}

fn cap_quota(quota: &[f64], caps: &[f64]) -> Vec<f64> {
    let cap = |at: usize| caps.get(at).copied().unwrap_or(f64::NAN);
    let mut kept: Vec<f64> = quota.iter().enumerate().map(|(at, &count)| jsmath::min(count, cap(at))).collect();
    let mut spare = sum_of(quota) - sum_of(&kept);
    let mut at = 0;
    while spare > 0.0 && at < kept.len() {
        let room = cap(at) - kept[at];
        if room > 0.0 {
            let take = jsmath::min(room, spare);
            kept[at] += take;
            spare -= take;
        }
        at += 1;
    }
    kept
}

struct Owed {
    o: usize,
    t: f64,
    r: f64,
    f: String,
    mine: Vec<usize>,
}

pub fn raise_troops(battle: &mut Battle, run: &Run, me: Option<usize>, only: i64) {
    let line = {
        let field = battle.field.as_mut().unwrap();
        let contour = trace_contour(field);
        measure_line(field, &contour)
    };
    let total = line.measured.total;
    battle.line_km = total;
    let members = [member_weights(battle, run, me, 0), member_weights(battle, run, me, 1)];
    let strengths = [sum_of(&members[0]), sum_of(&members[1])];
    let sized = size_sides(total, strengths, [battle.effort[0].as_str(), battle.effort[1].as_str()], run.troops);
    let mut counts = sized.counts;
    let sides = sides_val(battle);
    let said = authored_troops(run.input.get("authored"), &sides);
    let forms = authored_forms(run.input.get("authored"), &sides);
    if said.truthy() {
        for side in 0..2 {
            if said.at(side).num() > 0.0 {
                counts[side] = said.at(side).num();
            }
        }
    }
    battle.quality = [0, 1].map(|side| if only >= 0 && side as i64 != only { battle.quality[side] } else { round3(sized.quality[side]) });
    for side in 0..2 {
        if only >= 0 && side as i64 != only {
            continue;
        }
        let military = run.mech.military();
        let count = battle.sides[side].len();
        let raises = |at: usize| !(battle.gone[side].contains(&at) || land_worth(&run.military_of(&battle.sides[side][at])) == 0.0);
        let wholes: Vec<f64> = if military { (0..count).map(|at| if raises(at) { formations_left_with(run, &battle.sides[side][at], me, Some(&*battle)) } else { 0.0 }).collect() } else { Vec::new() };
        let parts: Vec<f64> = if military { (0..count).map(|at| if raises(at) { part_left_with(run, &battle.sides[side][at], me, Some(&*battle)) } else { 0.0 }).collect() } else { Vec::new() };
        let caps: Vec<f64> = wholes.iter().zip(&parts).map(|(&whole, &part)| whole + if part > 0.0 { 1.0 } else { 0.0 }).collect();
        let left = if military { sum_of(&caps) } else { side_formations_left_with(run, battle, side, me, Some(&*battle)) };
        let room = jsmath::max(0.0, jsmath::min(jsmath::min(counts[side], MAX_TROOPS_PER_SIDE - battle.troops[side].len() as f64), left));
        battle.base[side] = round3(sum_of(&members[side]));
        battle.pool[side] += room * POOL_PER_TROOP * battle.edge[side].reserves;
        let first = battle.troops[side].len();
        for kind in kinds_for(room as usize, run.era, None) {
            battle.troops[side].push(create_troop(TroopSeed { kind, ..TroopSeed::default() }));
        }
        let raised: Vec<usize> = (first..battle.troops[side].len()).collect();
        if raised.is_empty() {
            continue;
        }
        let length = raised.len() as f64;
        {
            let field = battle.field.as_ref().unwrap();
            let own = if side == 0 { &line.contour.cell_a } else { &line.contour.cell_b };
            let fallback = field.holders.iter().position(|&holder| holder as usize == side).map(|at| at as i64).unwrap_or(-1);
            let cols = field.cols as f64;
            let line_count = line.count() as f64;
            let own_at = |vertex: i64| if vertex >= 0 { own.get(vertex as usize).map(|&cell| cell as i64).unwrap_or(-1) } else { -1 };
            for (at, &index) in raised.iter().enumerate() {
                let mut vertex = jsmath::min(line_count - 1.0, (((at as f64 + 0.5) * line_count) / length).floor()) as i64;
                while vertex > 0 && own_at(vertex) < 0 {
                    vertex -= 1;
                }
                let home = (if own_at(vertex) >= 0 { own_at(vertex) } else { fallback }) as f64;
                let troop = &mut battle.troops[side][index];
                troop.x = (home % cols) + 0.5;
                troop.y = (home / cols).floor() + 0.5;
                draw_traits(troop, &run.seed, &battle.name, side as f64, (first + at) as f64, battle.even);
            }
        }
        plan_lanes(battle, side, &line);
        stand_at_places(battle, side);
        settle_raised(battle, side, &raised);
        let weights: Vec<f64> = if members[side].iter().any(|&weight| weight > 0.0) { members[side].clone() } else { (0..members[side].len()).map(|at| if battle.gone[side].contains(&at) { 0.0 } else { 1.0 }).collect() };
        let shared = share_out(length, &weights);
        let mut quota = if military { cap_quota(&shared, &caps) } else { shared };
        let mut waiting = Vec::new();
        for &index in &raised {
            let field = battle.field.as_ref().unwrap();
            let troop = &battle.troops[side][index];
            let cell = jsmath::max(0.0, own_cell(field, side as u8, troop.x, troop.y) as f64) as usize;
            let controller = fold_name(&run.controller_of(&battle.arena.ids[battle.arena.region[cell] as usize]));
            let local = battle.sides[side].iter().position(|member| fold_name(member) == controller);
            match local {
                Some(local) if quota[local] > 0.0 => {
                    battle.troops[side][index].owner = local as f64;
                    quota[local] -= 1.0;
                }
                _ => waiting.push(index),
            }
        }
        let mut owner = 0;
        for index in waiting {
            while owner + 1 < quota.len() && quota[owner] <= 0.0 {
                owner += 1;
            }
            battle.troops[side][index].owner = owner as f64;
            if let Some(slot) = quota.get_mut(owner) {
                *slot -= 1.0;
            }
        }
        if military {
            for owner in 0..count {
                let mine: Vec<usize> = raised.iter().copied().filter(|&index| battle.troops[side][index].owner == owner as f64).collect();
                if mine.is_empty() {
                    continue;
                }
                let kinds = kinds_for(mine.len(), run.era, mix_of(&run.military_of(&battle.sides[side][owner])));
                for (at, &index) in mine.iter().enumerate() {
                    battle.troops[side][index].kind = kinds[at];
                }
                if mine.len() as f64 > wholes[owner] && parts[owner] > 0.0 {
                    battle.troops[side][*mine.last().unwrap()].strength = jsmath::round(100.0 * parts[owner]);
                }
            }
        }
        let mut present = raised.clone();
        let war = run.wars.get(&battle.war_id.string_or_empty());
        let began = war.map(|war| Val::str(&war.began)).unwrap_or(Val::Undef);
        if musters_for(run.mech.muster(), run.input.get("authored").truthy(), &began, run.input.get("gameBegan")) {
            let war = war.unwrap();
            let today = run.date_of(run.day);
            let starter = (if battle.swap { 1 - side } else { side }) == 0;
            let mut keep: Vec<usize> = Vec::new();
            let mut owed: Vec<Owed> = Vec::new();
            for owner in 0..count {
                let mine: Vec<usize> = raised.iter().copied().filter(|&index| battle.troops[side][index].owner == owner as f64).collect();
                if mine.is_empty() {
                    continue;
                }
                let member = &battle.sides[side][owner];
                let head = if starter { head_start_of(run.muster_of(member).get("head"), true) } else { 0.0 };
                let since = if head > 0.0 {
                    let moved = add_game_days(&war.began, -head);
                    if moved.is_empty() {
                        war.began.clone()
                    } else {
                        moved
                    }
                } else {
                    war.began.clone()
                };
                let share = match diff_game_days(&since, &today) {
                    None => 1.0,
                    Some(days) => muster_share(run.muster_of(member).get("table").as_array().map(|table| table.as_slice()), days),
                };
                let now = jsmath::min(mine.len() as f64, (mine.len() as f64 * share).floor());
                for at in spread_pick(mine.len() as f64, now) {
                    if !keep.contains(&mine[at]) {
                        keep.push(mine[at]);
                    }
                }
                owed.push(Owed { o: owner, t: mine.len() as f64, r: now, f: since, mine });
            }
            let least = jsmath::min(length, troops_least(run.troops));
            let mut order: Vec<usize> = (0..owed.len()).collect();
            js::stable_sort_by(&mut order, |&a, &b| {
                let by = owed[b].t - owed[a].t;
                if by != 0.0 && !by.is_nan() {
                    by
                } else {
                    owed[a].o as f64 - owed[b].o as f64
                }
            });
            for at in order {
                let mine = owed[at].mine.clone();
                for index in mine {
                    if keep.len() as f64 >= least {
                        break;
                    }
                    if keep.contains(&index) {
                        continue;
                    }
                    keep.push(index);
                    owed[at].r += 1.0;
                }
            }
            present = raised.iter().copied().filter(|index| keep.contains(index)).collect();
            if present.len() < raised.len() {
                let mut troops: Vec<Troop> = battle.troops[side][..first].to_vec();
                for &index in &present {
                    troops.push(battle.troops[side][index].clone());
                }
                battle.troops[side] = troops;
                present = (first..first + present.len()).collect();
                battle.pool[side] -= (raised.len() - present.len()) as f64 * POOL_PER_TROOP * battle.edge[side].reserves;
                for entry in &owed {
                    if entry.r < entry.t {
                        battle.levy[side].push(Levy { o: entry.o as f64, t: entry.t, r: entry.r, f: entry.f.clone() });
                    }
                }
            }
        }
        let form = forms.at(side);
        let swarming = if form.truthy() { matches!(form, Val::Str(text) if text == SWARM_FORM) } else { run.warfare == SWARM_FORM };
        if swarming {
            raise_swarms(battle, side, &present);
        }
        for &index in &present {
            let troop = &battle.troops[side][index];
            let member = &battle.sides[side][troop.owner as usize];
            let men = if military { (troop.strength / 100.0) * men_of(run, member) } else { run.men_each };
            draw(run, member, men);
        }
    }
    battle.plan_key = String::new();
}

fn kind_of_type(unit: &Val) -> Option<f64> {
    match unit.get("type").string_or_empty().as_str() {
        "infantry" => Some(KIND_INFANTRY),
        "armor" => Some(KIND_ARMOUR),
        "artillery" => Some(KIND_ARTILLERY),
        _ => None,
    }
}

pub fn is_land_formation(unit: &Val) -> bool {
    kind_of_type(unit).is_some()
}

fn owner_name(unit: &Val) -> String {
    let owner = if unit.get("ownerCode").is_nullish() { unit.get("owner") } else { unit.get("ownerCode") };
    owner.string_or_empty()
}

fn nearest_vertex_distance(contour: &Contour, x: f64, y: f64) -> f64 {
    let mut best = f64::INFINITY;
    for vertex in 0..contour.x.len() {
        let dx = contour.x[vertex] - x;
        let dy = contour.y[vertex] - y;
        if dx * dx + dy * dy < best {
            best = dx * dx + dy * dy;
        }
    }
    best.sqrt()
}

pub fn absorb_unit(battle: &mut Battle, run: &mut Run, at: usize, unit: &Val, any_distance: bool) -> bool {
    let kind = kind_of_type(unit);
    let unit_id = js::trim(&unit.get("id").string_or_empty()).to_string();
    let owner = owner_name(unit);
    let side = side_of_name(battle, &owner);
    let Some(kind) = kind else { return false };
    if unit_id.is_empty() || side < 0 {
        return false;
    }
    let side = side as usize;
    if run.mech.military() && land_worth(&run.military_of(&owner)) == 0.0 {
        return false;
    }
    if battle.named.iter().any(|entry| matches!(&entry.unit_id, Val::Str(id) if *id == unit_id)) {
        return false;
    }
    if battle.troops[side].len() as f64 >= MAX_TROOPS_PER_SIDE || battle.named.len() as f64 >= MAX_NAMED_TROOPS {
        return false;
    }
    let lng = unit.get("lng").num();
    let lat = unit.get("lat").num();
    if !lng.is_finite() || !lat.is_finite() {
        return false;
    }
    let [x, y] = battle.place.to_cell(lng, lat);
    let field = battle.field.as_mut().unwrap();
    if !(x >= 0.0) || !(y >= 0.0) || x >= field.cols as f64 || y >= field.rows as f64 {
        return false;
    }
    if !any_distance {
        let contour = trace_contour(field);
        let reach = NAMED_WITHIN_KM / battle.place.km_at(y);
        let near = if reach <= REDISTANCE_REACH_CELLS { nearest_on_contour(field, &contour, x, y, reach).distance } else { nearest_vertex_distance(&contour, x, y) };
        if !(near <= reach) {
            return false;
        }
    }
    let wanted = fold_name(&owner);
    let member = battle.sides[side].iter().position(|member| fold_name(member) == wanted).map(|at| at as f64).unwrap_or(-1.0);
    let given = unit.get("strength").num();
    let strength = jsmath::min(100.0, jsmath::max(1.0, if given != 0.0 && !given.is_nan() { given } else { 100.0 }));
    battle.troops[side].push(create_troop(TroopSeed { x, y, strength, kind, owner: member, named: true, ..TroopSeed::default() }));
    let name = js::trim(&unit.get("name").string_or_empty()).to_string();
    battle.named.push(Named { s: side, i: battle.troops[side].len() - 1, name, unit_id: Val::str(&unit_id), reported: false });
    run.unit_changes.push(Val::obj([("unitId", Val::str(&unit_id)), ("committedTo", Val::obj([("battle", Val::Num(at as f64))]))]));
    battle.plan_key = String::new();
    true
}

pub fn release_named(battle: &mut Battle, run: &mut Run) {
    for entry in battle.named.iter_mut() {
        let Some(troop) = battle.troops.get(entry.s).and_then(|list| list.get(entry.i)) else { continue };
        if entry.reported {
            continue;
        }
        entry.reported = true;
        if !is_live(troop) {
            run.unit_changes.push(Val::obj([("unitId", entry.unit_id.clone()), ("committedTo", Val::str("")), ("remove", Val::Bool(true))]));
            continue;
        }
        let [lng, lat] = battle.place.to_lng_lat(troop.x, troop.y);
        run.unit_changes.push(Val::obj([("unitId", entry.unit_id.clone()), ("committedTo", Val::str("")), ("lng", Val::Num(lng)), ("lat", Val::Num(lat)), ("strength", Val::Num(jsmath::round(troop.strength)))]));
    }
}

fn report_the_fallen(battle: &Battle, changes: &mut Vec<Val>) {
    for entry in &battle.named {
        let Some(troop) = battle.troops.get(entry.s).and_then(|list| list.get(entry.i)) else { continue };
        if !is_live(troop) && !entry.reported {
            changes.push(Val::obj([("unitId", entry.unit_id.clone()), ("committedTo", Val::str("")), ("remove", Val::Bool(true))]));
        }
    }
}

fn whole_number(value: &Val) -> Option<f64> {
    match value {
        Val::Num(n) if n.is_finite() && n.trunc() == *n => Some(*n),
        _ => None,
    }
}

fn region_sides(battle: &Battle) -> (Vec<i32>, Option<Vec<i32>>) {
    let sides = battle.region_side.as_ref().map(|sides| sides.iter().map(|&side| side as i32).collect()).unwrap_or_default();
    let ice = battle.ice_side.as_ref().map(|ice| ice.iter().map(|&side| side as i32).collect());
    (sides, ice)
}

fn number_or_zero(value: &Val) -> f64 {
    let number = value.num();
    if number != 0.0 && !number.is_nan() {
        number
    } else {
        0.0
    }
}

fn copy_of(value: &Val) -> Obj {
    match value {
        Val::Ref(cell) => cell.borrow().clone(),
        other => js::spread(other),
    }
}

pub fn load_battle(run: &Run, record: &Val, arena: Rc<Arena>) -> Battle {
    let sides = [0, 1].map(|side| record.get("sides").at(side).array_or_empty().iter().map(|member| member.string_or_empty()).collect::<Vec<String>>());
    let mut battle = create_battle(
        run,
        Opening { name: record.get("name").string_or_empty(), war_id: record.get("warId").clone(), sides, frame: frame_from(record.get("frame")), arena: arena.clone(), opened_date: record.get("openedDate").clone(), opened_day: Val::Num(0.0) },
    );
    battle.status = record.get("status").string_or_empty();
    battle.fresh = false;
    set_handicap(&mut battle, run);
    let carry = if record.get("brief").get("carry").is_nullish() { Val::Obj(Obj::new()) } else { record.get("brief").get("carry").clone() };
    for entry in record.get("contested").array_or_empty() {
        if let (Val::Str(id), Val::Str(name)) = (entry.at(0), entry.at(1)) {
            if entry.as_array().is_some() && !id.is_empty() && !name.is_empty() {
                battle.shown.set(id.clone(), Val::str(name));
            }
        }
    }
    read_regions(&mut battle, run);
    let (region_side, ice) = region_sides(&battle);
    let saved = record.get("field");
    let key = match saved.get("key") {
        Val::Str(key) => Some(key.clone()),
        _ => None,
    };
    battle.field = Some(unpack_field(arena.clone(), &saved.get("mask").string_or_empty(), &saved.get("band").string_or_empty(), key.as_deref(), &region_side, ice.as_deref()));
    let decode = |side: usize| -> Vec<Troop> {
        decode_troops(&record.get("troops").at(side).string_or_empty())
            .into_iter()
            .map(|coded| create_troop(TroopSeed { x: coded.x, y: coded.y, strength: coded.strength, kind: coded.kind as f64, owner: coded.owner as f64, named: coded.named, dig: coded.dig, state: coded.state as f64 }))
            .collect()
    };
    let mut read = [decode(0), decode(1)];
    let under = carry.get("under");
    battle.served = under.as_array().map(|list| list.len() == 2).unwrap_or(false);
    if battle.served {
        for (side, list) in read.iter_mut().enumerate() {
            for (index, troop) in list.iter_mut().enumerate() {
                let serves = if under.at(side).as_array().is_some() { under.at(side).at(index).clone() } else { Val::Num(-1.0) };
                troop.serves = whole_number(&serves).unwrap_or(-1.0);
            }
        }
    }
    let ahead = carry.get("next");
    for (side, list) in read.iter_mut().enumerate() {
        for (index, troop) in list.iter_mut().enumerate() {
            let next = if ahead.as_array().is_some() && ahead.at(side).as_array().is_some() { ahead.at(side).at(index).clone() } else { Val::Num(-1.0) };
            troop.next = match whole_number(&next) {
                Some(next) if next >= 0.0 => next,
                _ => -1.0,
            };
        }
    }
    let commands = carry.get("command");
    for (side, list) in read.iter_mut().enumerate() {
        for (index, troop) in list.iter_mut().enumerate() {
            let command = if commands.as_array().is_some() && commands.at(side).as_array().is_some() { commands.at(side).at(index).clone() } else { Val::Num(-1.0) };
            troop.command = match whole_number(&command) {
                Some(command) if command >= 0.0 && command < MAX_COMMANDS => command,
                _ => -1.0,
            };
        }
    }
    if carry.get("tired").as_array().is_some() {
        for (side, list) in read.iter_mut().enumerate() {
            let levels = decode_levels(&carry.get("tired").at(side).string_or_empty());
            for (index, troop) in list.iter_mut().enumerate() {
                troop.fatigue = levels.get(index).copied().unwrap_or(0.0);
            }
        }
    }
    battle.generals = read_generals(carry.get("generals"));
    battle.talk = read_talk(carry.get("talk"));
    battle.swarms = read_swarms(carry.get("swarms")).map(|list| {
        let mut unique: Vec<usize> = Vec::new();
        for command in list {
            if !unique.contains(&command) {
                unique.push(command);
            }
        }
        unique
    });
    battle.plans = if carry.get("plans").as_array().is_some() { carry.get("plans").clone() } else { Val::Null };
    battle.deploy = if carry.get("deploy").as_array().is_some() { Some(read_deploy(carry.get("deploy"))) } else { None };
    battle.staff_plans = read_staff_plans(carry.get("staff"));
    battle.chronicle = read_chronicle(record.get("chronicle"));
    battle.levy = read_levy(carry.get("levy"));
    {
        let field = battle.field.as_ref().unwrap();
        for (side, list) in read.iter_mut().enumerate() {
            for troop in list.iter_mut() {
                if !(troop.strength > 0.0) {
                    continue;
                }
                let cell = cell_at(field, troop.x, troop.y);
                if cell >= 0 && field.play[cell as usize] != 0 {
                    continue;
                }
                let to = nearest_held(field, side as u8, troop.x, troop.y, THAW_REACH_CELLS);
                if to < 0 {
                    troop.strength = 0.0;
                    continue;
                }
                troop.x = (to as f64 % field.cols as f64) + 0.5;
                troop.y = (to as f64 / field.cols as f64).floor() + 0.5;
                troop.strength *= 1.0 - THAW_LOSS;
            }
        }
    }
    let named: Vec<Named> = record
        .get("named")
        .array_or_empty()
        .iter()
        .map(|entry| Named { s: entry.get("s").num() as usize, i: entry.get("i").num() as usize, name: entry.get("name").string_or_empty(), unit_id: entry.get("unitId").clone(), reported: false })
        .collect();
    let (troops, named) = drop_the_dead(read, &named);
    battle.troops = troops;
    battle.named = named;
    let pair = |key: &str| [record.get(key).at(0).num(), record.get(key).at(1).num()];
    battle.pool = pair("pool");
    battle.base = pair("base");
    battle.quality = pair("quality");
    battle.effort = [record.get("effort").at(0).string_or_empty(), record.get("effort").at(1).string_or_empty()];
    if let Some(minds) = record.get("mind").as_array() {
        battle.mind = Val::Arr(minds.iter().map(|list| if list.as_array().is_some() { list.clone() } else { Val::Arr(Vec::new()) }).collect());
    }
    let ages = carry.get("ages");
    let from_date = run.input.get("fromDate").string_or_empty();
    battle.orders = record
        .get("orders")
        .array_or_empty()
        .iter()
        .enumerate()
        .map(|(index, order)| {
            let stood = if ages.as_array().is_some() && js::is_finite(ages.at(index)) { ages.at(index).num() } else { diff_game_days(&order.read("since").string_or_empty(), &from_date).unwrap_or(0.0) };
            let mut copy = copy_of(order);
            copy.set("age", Val::Num(jsmath::max(0.0, number_or_zero(&Val::Num(stood)).floor())));
            Val::shared(copy)
        })
        .collect();
    battle.halts = carry
        .get("halts")
        .array_or_empty()
        .iter()
        .filter(|halt| js::side_index(halt.get("s")).is_some() && halt.get("days").num() > 0.0)
        .map(|halt| {
            let sector = if halt.get("sector").is_nullish() { "all".to_string() } else { js::to_string(halt.get("sector")) };
            Val::obj([("s", halt.get("s").clone()), ("sector", Val::Str(sector)), ("days", Val::Num(halt.get("days").num().floor()))])
        })
        .collect();
    battle.anchors = carry
        .get("anchors")
        .array_or_empty()
        .iter()
        .filter(|anchor| js::side_index(anchor.get("s")).is_some() && js::is_finite(anchor.get("x")) && js::is_finite(anchor.get("y")))
        .map(|anchor| Val::obj([("s", anchor.get("s").clone()), ("x", anchor.get("x").clone()), ("y", anchor.get("y").clone())]))
        .collect();
    battle.pockets = carry
        .get("pockets")
        .array_or_empty()
        .iter()
        .filter(|pocket| js::side_index(pocket.get("s")).is_some() && whole_number(pocket.get("cell")).is_some())
        .map(|pocket| Pocket {
            s: js::side_index(pocket.get("s")).unwrap(),
            cell: pocket.get("cell").num(),
            days: jsmath::max(0.0, number_or_zero(pocket.get("days")).floor()),
            km2: 0.0,
            cells: None,
            cx: None,
            cy: None,
            siege: String::new(),
            told: pocket.get("told").is_true(),
        })
        .collect();
    battle.log = record.get("log").array_or_empty().iter().map(|entry| Val::Obj(copy_of(entry))).collect();
    battle.log_from = battle.log.len() as f64;
    battle.quiet = jsmath::max(0.0, number_or_zero(carry.get("quiet")).floor());
    battle.away = [carry.get("away").at(0).is_true(), carry.get("away").at(1).is_true()];
    let mut sent = OrdMap::new();
    let listed: Vec<&Val> = carry
        .get("sentHome")
        .array_or_empty()
        .iter()
        .filter(|entry| entry.as_array().is_some() && matches!(entry.at(0), Val::Str(id) if !id.is_empty()) && js::side_index(entry.at(1)).is_some())
        .take(MAX_NAMED_TROOPS as usize)
        .collect();
    for entry in listed {
        sent.set(entry.at(0).string_or_empty(), entry.at(1).clone());
    }
    battle.sent_home = sent;
    battle
}

pub struct Opened {
    pub name: String,
    pub war_id: Val,
    pub sides: [Vec<String>; 2],
    pub frame: Frame,
    pub arena: Rc<Arena>,
    pub day: f64,
}

pub fn open_battle(run: &Run, opened: Opened) -> Option<Battle> {
    let Opened { name, war_id, sides, frame, arena, day } = opened;
    let mut battle = create_battle(run, Opening { name, war_id, sides, frame, arena: arena.clone(), opened_date: Val::Str(run.date_of(day)), opened_day: Val::Num(day) });
    set_handicap(&mut battle, run);
    read_regions(&mut battle, run);
    let (region_side, ice) = region_sides(&battle);
    let mut field = open_field(arena, run.input.get("map").get("regions").array_or_empty(), &region_side, ice.as_deref())?;
    if trace_contour(&mut field).segments == 0 {
        return None;
    }
    battle.field = Some(field);
    line_length(&mut battle);
    Some(battle)
}

fn taken_rings(battle: &Battle) -> Vec<Strand> {
    let field = battle.field.as_ref().unwrap();
    let (cols, rows, size) = (field.cols, field.rows, field.size);
    let homes = battle.homes.as_deref().unwrap_or(&[]);
    let mut rings = Vec::new();
    for side in 0..2u8 {
        let mut taken = vec![0u8; size];
        let mut any = false;
        for index in 0..size {
            if field.holders[index] != side || homes.get(index).copied() == Some(side) {
                continue;
            }
            taken[index] = 1;
            any = true;
        }
        if !any {
            continue;
        }
        let mut scratch = field.clone();
        scratch.edits = 0;
        scratch.contour = None;
        scratch.contour_edits = -1;
        scratch.play = vec![1; size];
        scratch.holders = vec![HOLDER_SIDE_B as u8; size];
        scratch.phi = vec![FAR_CELLS; size];
        scratch.ghost = (0..size as i32).collect();
        scratch.piece_from = vec![-1; size * 2];
        scratch.piece_to = vec![-1; size * 2];
        for index in 0..size {
            let col = index % cols;
            let row = index / cols;
            if col == 0 || row == 0 || col == cols - 1 || row == rows - 1 {
                continue;
            }
            let mut inside = taken[index] == 1;
            for dy in -1i64..=1 {
                if inside {
                    break;
                }
                for dx in -1i64..=1 {
                    if inside {
                        break;
                    }
                    inside = taken[(index as i64 + dy * cols as i64 + dx) as usize] == 1;
                }
            }
            if !inside {
                continue;
            }
            let other = field.holders[index] == 1 - side;
            let distance = if field.play[index] != 0 { jsmath::max(1.0 / 64.0, field.phi[index].abs()) } else { 0.5 };
            scratch.phi[index] = if other { distance } else { -distance };
            scratch.holders[index] = if other { HOLDER_SIDE_B as u8 } else { HOLDER_SIDE_A as u8 };
        }
        let contour = trace_contour(&mut scratch);
        let flags = vec![side as f64; contour.x.len()];
        for strand in draw_line(&contour, &flags) {
            if strand.closed {
                rings.push(strand);
            }
        }
    }
    rings
}

fn stuck_orders(battle: &Battle, serving: &[Vec<Option<Val>>; 2], day: f64) -> Vec<Val> {
    let mut going: Vec<(Val, bool)> = Vec::new();
    for side in 0..2 {
        for (index, troop) in battle.troops[side].iter().enumerate() {
            let Some(standing) = &serving[side][index] else { continue };
            if !standing.read("chosen").truthy() || !matches!(standing.read("order"), Val::Str(word) if is_attack(&word)) {
                continue;
            }
            let live = troop.order.truthy() && !troop.order.get("done").truthy();
            let way = live && matches!(troop.order.get("kind"), Val::Str(kind) if kind == "way");
            let moves = !way || {
                let mark = troop.order.get("markDay");
                let since = if mark.is_nullish() { troop.order.get("since") } else { mark };
                day - since.num() < HAND_STALL_DAYS
            };
            match going.iter_mut().find(|(order, _)| order.same_ref(standing)) {
                Some(entry) => entry.1 = entry.1 || moves,
                None => going.push((standing.clone(), moves)),
            }
        }
    }
    going.into_iter().filter(|(_, moves)| !moves).map(|(order, _)| order).collect()
}

fn plans_kept(battle: &Battle) -> Val {
    let Some(lists) = battle.plans.as_array() else { return battle.plans.clone() };
    if battle.days_run <= 0.0 {
        return battle.plans.clone();
    }
    Val::Arr(
        lists
            .iter()
            .map(|list| match list {
                Val::Arr(plans) => Val::Arr(plans.iter().filter(|plan| !matches!(plan.get("kind"), Val::Str(kind) if kind == "diversion")).cloned().collect()),
                other => other.clone(),
            })
            .collect(),
    )
}

pub fn read_staff_plans(value: &Val) -> Val {
    let Some(list) = value.as_array() else { return Val::Null };
    let read: Vec<Val> = (0..2)
        .map(|side| {
            let plan = list.get(side).cloned().unwrap_or(Val::Undef);
            let text = match plan.read("plan") {
                Val::Str(text) if !text.is_empty() && matches!(plan, Val::Obj(_) | Val::Ref(_)) => text,
                _ => return Val::Null,
            };
            let mut out = Obj::new();
            out.set("plan", Val::Str(js::slice_units(&text, 0, 80)));
            if let Val::Str(at) = plan.read("at") {
                if !at.is_empty() {
                    out.set("at", Val::Str(js::slice_units(&at, 0, 120)));
                }
            }
            out.set("since", Val::Str(js::slice_units(&plan.read("since").string_or_empty(), 0, 40)));
            let n = plan.read("n").num();
            out.set("n", Val::Num(if n > 0.0 { n.floor() } else { 0.0 }));
            Val::Obj(out)
        })
        .collect();
    if read.iter().any(|plan| plan.truthy()) {
        Val::Arr(read)
    } else {
        Val::Null
    }
}

const SUPPLY_STRETCHED: f64 = 0.9;

fn supply_levels(battle: &Battle) -> Vec<u8> {
    let field = battle.field.as_ref().unwrap();
    let mut levels = vec![0u8; field.size];
    for cell in 0..field.size {
        let holder = field.holders[cell] as usize;
        if holder != 0 && holder != 1 {
            continue;
        }
        if let Some(fed) = &battle.fed {
            if fed[holder].get(cell).copied() != Some(1) {
                levels[cell] = 3;
                continue;
            }
        }
        let supply = battle.supply.as_ref().and_then(|supply| supply[holder].get(cell)).map(|&value| value as f64).unwrap_or(0.0);
        levels[cell] = if supply > 0.0 && supply < SUPPLY_STRETCHED { 2 } else { 1 };
    }
    levels
}

fn within(value: f64) -> f64 {
    jsmath::min(value.floor() + 1.0 - 1.0 / TROOP_UNITS, jsmath::max(value.floor(), jsmath::round(value * TROOP_UNITS) / TROOP_UNITS))
}

pub fn finished_val(done: &Finished) -> Val {
    let mut out = Obj::new();
    out.set("d", Val::str(&done.d));
    out.set("n", Val::Num(done.n));
    out.set("s", Val::Num(done.s));
    out.set("e", Val::Num(done.e));
    out.set("t", Val::Arr(done.t.iter().map(|text| Val::str(text)).collect()));
    out.set("names", Val::Arr(done.names.iter().map(|name| Val::str(name)).collect()));
    out.set("m", Val::str(&done.m));
    out.set("p", Val::str(&done.p));
    if let Some((first, turns)) = &done.shown {
        out.set("o", Val::Arr(first.iter().map(|(id, name)| Val::Arr(vec![Val::str(id), Val::str(name)])).collect()));
        out.set("f", Val::Arr(turns.iter().map(|(day, id, name)| Val::Arr(vec![Val::Num(*day), Val::str(id), Val::str(name)])).collect()));
    }
    Val::Obj(out)
}

fn index_in(list: &[Val], order: &Val) -> f64 {
    list.iter().position(|item| item.same_ref(order)).map(|at| at as f64).unwrap_or(-1.0)
}

fn order_record(order: &Val) -> Val {
    let mut out = Obj::new();
    out.set("s", order.read("s"));
    out.set("sector", order.read("sector"));
    out.set("order", order.read("order"));
    out.set("since", order.read("since"));
    for key in ["objective", "effort", "by"] {
        let value = order.read(key);
        if value.truthy() {
            out.set(key, value);
        }
    }
    let chosen = order.read("chosen").truthy();
    if chosen {
        out.set("chosen", Val::Bool(true));
    }
    let mark = order.read("mark");
    let line_mark = matches!(&mark, Val::Str(text) if LINE_MARKS.contains(&text.as_str()));
    if (chosen || line_mark) && mark.truthy() {
        out.set("mark", mark);
    }
    let way = order.read("way");
    if way.as_array().map(|list| !list.is_empty()).unwrap_or(false) {
        out.set("way", way);
    }
    let attacks = order.read("attacks");
    if chosen && attacks.as_array().map(|list| !list.is_empty()).unwrap_or(false) {
        out.set("attacks", attacks);
    }
    Val::Obj(out)
}

fn next_point(serving: Option<&Val>, orders: &[Val], troop: &Troop) -> f64 {
    let Some(standing) = serving else { return -1.0 };
    let way = standing.read("way");
    if !orders.iter().any(|order| order.same_ref(standing)) || way.as_array().map(|list| list.is_empty()).unwrap_or(true) {
        return -1.0;
    }
    let live = |order: &Val| order.truthy() && !order.get("done").truthy();
    let is_way = |order: &Val| matches!(order.get("kind"), Val::Str(kind) if kind == "way");
    let mut held = if live(&troop.order) { Some(troop.order.clone()) } else { None };
    if let Some(order) = &held {
        if !is_way(order) {
            let resume = order.get("resume").clone();
            held = if live(&resume) { Some(resume) } else { None };
        }
    }
    let Some(order) = held else { return -1.0 };
    if !is_way(&order) || !matches!(order.get("word"), Val::Str(word) if word == "path") || whole_number(order.get("skip")).is_none() {
        return -1.0;
    }
    let legs = order.get("legs").array_or_empty();
    let mut leg = order.get("leg").num();
    while leg < legs.len() as f64 - 1.0 && left_on_leg(&Leg::of(&legs[leg as usize]), troop.x, troop.y) <= 0.0 {
        leg += 1.0;
    }
    order.get("skip").num() + leg
}

pub fn save_battle(battle: &mut Battle, run: &Run, day: f64, changes: &mut Vec<Val>, brief: &Val) -> Val {
    let arena = battle.arena.clone();
    let mut owners: [Vec<f64>; 2] = [Vec::new(), Vec::new()];
    let mut sides: [Vec<String>; 2] = [Vec::new(), Vec::new()];
    for side in 0..2 {
        for (index, member) in battle.sides[side].iter().enumerate() {
            let gone = battle.gone[side].contains(&index);
            owners[side].push(if gone { 0.0 } else { sides[side].len() as f64 });
            if !gone {
                sides[side].push(member.clone());
            }
        }
    }
    let owner_at = |side: usize, owner: f64| if owner >= 0.0 && owner.fract() == 0.0 { owners[side].get(owner as usize).copied() } else { None };
    let troops: Vec<Val> = (0..2)
        .map(|side| {
            let codes: Vec<TroopCode> = battle.troops[side]
                .iter()
                .map(|troop| TroopCode { x: within(troop.x), y: within(troop.y), strength: troop.strength, kind: troop.kind, owner: owner_at(side, troop.owner).unwrap_or(0.0), named: troop.named, dig: troop.dig, state: troop.state })
                .collect();
            Val::Str(encode_troops(&codes))
        })
        .collect();
    report_the_fallen(battle, changes);
    let closed = battle.status == "closed";
    let mut disputed: Vec<usize> = Vec::new();
    if !closed {
        let region_side = battle.region_side.as_ref().unwrap();
        for region in 1..arena.ids.len() {
            let name = battle.shown.get(&arena.ids[region]).cloned().unwrap_or(Val::Undef);
            if region_side[region] >= 0 && name.truthy() && fold_name(&name.string_or_empty()) != fold_name(&holder_of(battle, run, &arena.ids[region])) {
                disputed.push(region);
            }
        }
    }
    if disputed.len() as f64 > MAX_CONTESTED_REGIONS {
        let mut sorted = disputed.clone();
        js::stable_sort_by(&mut sorted, |&a, &b| {
            let by = (arena.cells[b] - arena.cells[a]) as f64;
            if by != 0.0 {
                by
            } else {
                a as f64 - b as f64
            }
        });
        sorted.truncate(MAX_CONTESTED_REGIONS as usize);
        disputed.retain(|region| sorted.contains(region));
    }
    let contested: Vec<Val> = disputed.iter().map(|&region| Val::Arr(vec![Val::str(&arena.ids[region]), battle.shown.get(&arena.ids[region]).cloned().unwrap_or(Val::Undef)])).collect();
    let swarms = swarms_kept(battle);
    let serving: [Vec<Option<Val>>; 2] = [0, 1].map(|side| battle.troops[side].iter().map(|troop| standing_of(battle, troop)).collect());
    let mut served: Vec<Val> = Vec::new();
    for list in &serving {
        for order in list.iter().flatten() {
            if !served.iter().any(|known| known.same_ref(order)) {
                served.push(order.clone());
            }
        }
    }
    let stuck = stuck_orders(battle, &serving, day);
    let orders: Vec<Val> = battle.orders.iter().filter(|order| !order.read("chosen").truthy() || (served.iter().any(|known| known.same_ref(order)) && !stuck.iter().any(|known| known.same_ref(order)))).cloned().collect();
    let plans = plans_kept(battle);
    let next: Vec<Vec<f64>> = (0..2).map(|side| battle.troops[side].iter().enumerate().map(|(index, troop)| next_point(serving[side][index].as_ref(), &orders, troop)).collect()).collect();
    let mut record = Obj::new();
    record.set("v", Val::Num(BATTLEFIELD_VERSION));
    record.set("name", Val::str(&battle.name));
    record.set("warId", battle.war_id.clone());
    record.set("status", Val::str(&battle.status));
    record.set("sides", Val::Arr(sides.iter().map(|members| Val::Arr(members.iter().map(|member| Val::str(member)).collect())).collect()));
    record.set("openedDate", battle.opened_date.clone());
    record.set("asOf", Val::Str(if closed { battle.closed_date.clone() } else { run.date_of(day) }));
    record.set("frame", frame_record(&battle.frame));
    record.set("troops", Val::Arr(troops));
    record.set("named", Val::Arr(battle.named.iter().map(|entry| Val::obj([("s", Val::Num(entry.s as f64)), ("i", Val::Num(entry.i as f64)), ("name", Val::str(&entry.name)), ("unitId", entry.unit_id.clone())])).collect()));
    record.set("pool", Val::nums(&battle.pool.map(round3)));
    record.set("base", Val::nums(&battle.base));
    record.set("quality", Val::nums(&battle.quality));
    record.set("effort", Val::Arr(battle.effort.iter().map(|effort| Val::str(effort)).collect()));
    if let Some(minds) = battle.mind.as_array() {
        record.set("mind", Val::Arr(minds.iter().map(|list| if list.as_array().is_some() { list.clone() } else { Val::Arr(Vec::new()) }).collect()));
    }
    record.set("orders", Val::Arr(orders.iter().map(order_record).collect()));
    let replay = match &battle.replay {
        Some(replay) if !replay.is_nullish() => replay.clone(),
        _ => finished_val(&battle.recorder.as_ref().expect("a recorder").finish(run.input.get("fromDate"), &Val::Num(day))),
    };
    record.set("replay", replay);
    record.set("held", Val::str(""));
    record.set("contested", Val::Arr(contested));
    let mut told = js::spread(brief);
    if !closed {
        told.set("supply", Val::Str(encode_mask(&supply_levels(battle))));
    }
    if !closed && run.mech.weather() {
        let ahead = skies_ahead(run, battle, day, FORECAST_DAYS);
        told.set("forecast", Val::Arr(ahead.iter().map(|(date, state)| Val::obj([("d", Val::str(date)), ("w", Val::str(state))])).collect()));
    }
    let mut carry = Obj::new();
    carry.set("under", Val::Arr(serving.iter().map(|list| Val::Arr(list.iter().map(|order| Val::Num(order.as_ref().map(|order| index_in(&orders, order)).unwrap_or(-1.0))).collect())).collect()));
    carry.set("ages", Val::Arr(orders.iter().map(|order| order.read("age")).collect()));
    if next.iter().any(|list| list.iter().any(|&point| point >= 0.0)) {
        carry.set("next", Val::Arr(next.iter().map(|list| Val::nums(list)).collect()));
    }
    carry.set("command", Val::Arr(battle.troops.iter().map(|list| Val::Arr(list.iter().map(|troop| Val::Num(if is_live(troop) { troop.command } else { -1.0 })).collect())).collect()));
    if battle.generals.iter().any(|names| names.iter().any(|name| !name.is_empty())) {
        carry.set("generals", Val::Arr(battle.generals.iter().map(|names| Val::Arr(names.iter().map(|name| Val::str(name)).collect())).collect()));
    }
    if swarms.iter().any(|list| !list.is_empty()) {
        carry.set("swarms", Val::Arr(swarms.iter().map(|list| Val::Arr(list.iter().map(|&command| Val::Num(command as f64)).collect())).collect()));
    }
    if levy_owed(&battle.levy) {
        let levy: Vec<Val> = (0..2)
            .map(|side| {
                Val::Arr(
                    battle.levy[side]
                        .iter()
                        .filter(|entry| entry.r < entry.t && !(entry.o >= 0.0 && entry.o.fract() == 0.0 && battle.gone[side].contains(&(entry.o as usize))))
                        .map(|entry| Val::Arr(vec![owner_at(side, entry.o).map(Val::Num).unwrap_or(Val::Undef), Val::Num(entry.t), Val::Num(entry.r), Val::str(&entry.f)]))
                        .collect(),
                )
            })
            .collect();
        carry.set("levy", Val::Arr(levy));
    }
    if run.mech.fatigue() && battle.troops.iter().any(|list| list.iter().any(|troop| is_live(troop) && troop.fatigue > 0.0)) {
        carry.set("tired", Val::Arr(battle.troops.iter().map(|list| Val::Str(encode_levels(&list.iter().map(|troop| if is_live(troop) { troop.fatigue } else { 0.0 }).collect::<Vec<f64>>()))).collect()));
    }
    if battle.talk.iter().any(|lines| !lines.is_empty()) {
        carry.set("talk", Val::Arr(battle.talk.iter().map(|lines| Val::Arr(lines.iter().map(talk_val).collect())).collect()));
    }
    if plans.truthy() {
        carry.set("plans", plans);
    }
    if let Some(deploy) = &battle.deploy {
        if has_lines(deploy) {
            carry.set("deploy", Val::Arr(deploy.iter().map(|lines| Val::Arr(lines.iter().map(line_val).collect())).collect()));
        }
    }
    if battle.staff_plans.as_array().map(|plans| plans.iter().any(|plan| plan.truthy())).unwrap_or(false) {
        carry.set("staff", battle.staff_plans.clone());
    }
    if battle.status == "standing" {
        carry.set("quiet", Val::Num(battle.quiet));
    }
    if battle.away[0] || battle.away[1] {
        carry.set("away", Val::Arr(vec![Val::Bool(battle.away[0]), Val::Bool(battle.away[1])]));
    }
    if !battle.sent_home.is_empty() {
        carry.set("sentHome", Val::Arr(battle.sent_home.entries.iter().map(|(id, side)| Val::Arr(vec![Val::str(id), side.clone()])).collect()));
    }
    carry.set("halts", Val::Arr(battle.halts.iter().map(|halt| Val::obj([("s", halt.read("s")), ("sector", halt.read("sector")), ("days", halt.read("days"))])).collect()));
    carry.set("anchors", Val::Arr(battle.anchors.iter().map(|anchor| Val::obj([("s", anchor.read("s")), ("x", anchor.read("x")), ("y", anchor.read("y"))])).collect()));
    let pockets: Vec<Val> = battle
        .pockets
        .iter()
        .map(|pocket| {
            let mut out = Obj::new();
            out.set("s", Val::Num(pocket.s as f64));
            out.set("cell", Val::Num(pocket.cell));
            out.set("days", Val::Num(pocket.days));
            if pocket.told {
                out.set("told", Val::Bool(true));
            }
            Val::Obj(out)
        })
        .collect();
    carry.set("pockets", Val::Arr(pockets));
    told.set("carry", Val::Obj(carry));
    record.set("brief", Val::Obj(told));
    let from = battle.log.len().saturating_sub(MAX_LOG_ENTRIES as usize);
    record.set("log", Val::Arr(battle.log[from..].to_vec()));
    let date = if closed { battle.closed_date.clone() } else { run.date_of(day) };
    record.set("chronicle", chronicle_record(&chronicle_after(battle, &Val::Str(date))));
    if closed {
        record.set("closedDate", Val::str(&battle.closed_date));
    } else {
        let packed = pack_field(battle.field.as_ref().unwrap());
        record.set("field", Val::obj([("mask", Val::Str(packed.mask)), ("band", Val::Str(packed.band)), ("key", Val::Str(packed.key))]));
        record.set("held", Val::Str(encode_lines(&taken_rings(battle))));
    }
    Val::Obj(record)
}
