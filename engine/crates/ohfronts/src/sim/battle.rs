use super::air::BattleWings;
use super::arena::Arena;
use super::chronicle::Chronicle;
use super::climate::{ZoneToday, ZoneWeights};
use super::constants::{Edge, CONTROL_RADIUS_MAX_KM, DEFAULT_EFFORT};
use super::deploy::DeployLine;
use super::engine::Run;
use super::field::{Claims, Field};
use super::frame::{Frame, Projector};
use super::ground::ToSide;
use super::handicap::FAIR_EDGE;
use super::js::{OrdMap, Val};
use super::muster::Levy;
use super::troops::Troop;
use super::walls::Walls;
use super::weather::Sky;
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
    pub halts_today: Vec<Val>,
    pub views: [Vec<Val>; 2],
    pub plans: Val,
    pub deploy: Option<[Vec<DeployLine>; 2]>,
    pub plan_key: String,
    pub pockets: Vec<Val>,
    pub pocket_of: Val,
    pub pocket_turns: f64,
    pub close: Val,
    pub to_side: Option<ToSide>,
    pub fed: Val,
    pub body_of: Val,
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
    pub spared: [Vec<Val>; 2],
    pub siege_key: String,
    pub kept: [Val; 2],
    pub supplied: [Val; 2],
    pub supply: Val,
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
    pub homes: Val,
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
        pocket_of: Val::Null,
        pocket_turns: -1.0,
        close: Val::Null,
        to_side: None,
        fed: Val::Null,
        body_of: Val::Null,
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
        kept: [Val::Null, Val::Null],
        supplied: [Val::Null, Val::Null],
        supply: Val::Null,
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
        homes: Val::Null,
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
    }
}

pub fn keep_start(battle: &mut Battle) {
    if let Some(field) = &battle.field {
        battle.start_phi = Some(field.phi.clone());
        battle.start_holders = Some(field.holders.clone());
        battle.city_holder = Some(battle.arena.cities.iter().map(|city| field.holders[city.cell as usize] as i8).collect());
    }
}
