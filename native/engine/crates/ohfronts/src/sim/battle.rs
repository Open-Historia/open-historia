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
use super::line::measure_line;
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
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Clone, Debug, PartialEq)]
pub struct Named {
    pub s: usize,
    pub i: usize,
    pub name: String,
    pub unit_id: Val,
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
    pub drawn_homes: Val,
    pub served: bool,
    pub generals: [Vec<Val>; 2],
    pub swarms: [Vec<usize>; 2],
    pub talk: [Vec<Val>; 2],
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
    pub recorder: Val,
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
        drawn_homes: Val::Null,
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
        recorder: Val::Null,
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
        watch: false,
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
