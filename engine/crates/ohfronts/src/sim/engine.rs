use super::air::Wing;
use super::battle::{create_battle, Battle, Opening};
use super::climate::ZoneSky;
use super::walls::WallLine;
use super::constants::MAX_SIDE_MEMBERS;
use super::game_dates::add_game_days;
use super::js::{self, OrdMap, Val};
use super::manpower::men_per_formation;
use super::mechanics::{read_mechanics, Mechanics};
use super::military::{read_military, Military, MILITARY_NEUTRAL};
use super::swarms::SWARM_FORM;
use super::troops::troops_factor;
use super::unit_motion::{era_of, ADVANCE_KM_PER_DAY, OVERLAND_KM_PER_DAY};
use crate::jsmath;
use super::arena::Arena;
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::sync::Arc as Rc;
use super::transports::Transport;
use super::world_grid::WorldGrid;

pub trait Hooks {
    fn controller_of(&self, _id: &str) -> Val {
        Val::Undef
    }
    fn sovereign_of(&self, _id: &str) -> Val {
        Val::Undef
    }
    fn is_group(&self, _name: &str) -> Val {
        Val::Undef
    }
    fn strength_of(&self, _name: &str) -> Val {
        Val::Undef
    }
    fn shortage_of(&self, _name: &str) -> Val {
        Val::Undef
    }
    fn military_of(&self, _name: &str) -> Val {
        Val::Undef
    }
    fn muster_of(&self, _name: &str) -> Val {
        Val::Undef
    }
    fn people_of(&self, _name: &str) -> Val {
        Val::Undef
    }
}

pub struct NoHooks;

pub enum Said {
    Undefined,
    Null,
    Own(Own),
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Own {
    pub air: Option<String>,
    pub plan: Option<String>,
    pub aim: Option<Vec<f64>>,
    pub keep: bool,
    pub troops: Option<Vec<Body>>,
    pub order: Val,
    pub sector: Val,
    pub draft: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Body {
    pub order: String,
    pub picked: Vec<usize>,
    pub way: Option<Vec<[f64; 2]>>,
}

pub struct Asked<'a> {
    pub began: bool,
    pub today: &'a super::day::Today,
    pub key: String,
    pub regular: bool,
    pub at: usize,
}

pub trait StaffHook {
    fn often(&self) -> bool;
    fn decide(&self, run: &Run, battle: &mut Battle, side: usize, asked: &Asked) -> Said;
}

impl Hooks for NoHooks {}

pub fn clean(value: &Val, max: usize) -> String {
    let text = js::trim(&js::collapse_spaces(&value.string_or_empty())).to_string();
    js::trim(&js::slice_units(&text, 0, max)).to_string()
}

pub fn clean_text(text: &str, max: usize) -> String {
    clean(&Val::str(text), max)
}

pub fn fold(value: &Val) -> String {
    clean(value, 120).to_lowercase()
}

pub fn fold_text(text: &str) -> String {
    clean_text(text, 120).to_lowercase()
}

pub fn member_list(value: &Val) -> Vec<String> {
    let mut members: Vec<String> = Vec::new();
    for entry in value.array_or_empty() {
        let name = clean(entry, 120);
        if !name.is_empty() && !members.iter().any(|member| fold_text(member) == fold_text(&name)) && (members.len() as f64) < MAX_SIDE_MEMBERS {
            members.push(name);
        }
    }
    members
}

#[derive(Clone, Debug, PartialEq)]
pub struct ManEntry {
    pub name: String,
    pub drawn: f64,
    pub returned: f64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Mend {
    pub day: Option<f64>,
    pub left: OrdMap<String, f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Effort {
    pub name: String,
    pub advanced: f64,
    pub troop_days: f64,
    pub war_days: f64,
    pub last_day: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct War {
    pub id: String,
    pub title: String,
    pub status: String,
    pub sides: [Vec<String>; 2],
    pub began: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Moment {
    pub moment: Val,
    pub index: usize,
    pub day: f64,
}

pub struct Run {
    pub input: Rc<Val>,
    pub hooks: Rc<dyn Hooks>,
    pub staff_policy: Option<Rc<dyn StaffHook>>,
    pub rehearsing: bool,
    pub days: f64,
    pub day: f64,
    pub steps: f64,
    pub era: usize,
    pub mech: Mechanics,
    pub warfare: String,
    pub seed: String,
    pub troops: f64,
    pub men_each: f64,
    pub manpower_share: f64,
    pub manpower: RefCell<OrdMap<String, ManEntry>>,
    pub effort: OrdMap<String, Effort>,
    pub pace: f64,
    pub steer: Val,
    pub advance_km: [f64; 3],
    pub overland_km: [f64; 3],
    pub battles: Vec<Battle>,
    pub wars: OrdMap<String, War>,
    pub flips: Vec<Val>,
    pub joins: Vec<Val>,
    pub starts: Vec<Val>,
    pub transports: Vec<Transport>,
    pub voyages: Vec<Val>,
    pub unit_changes: Vec<Val>,
    pub notes: Vec<Val>,
    pub taken: Vec<String>,
    pub cursor: f64,
    pub flips_left: f64,
    pub braked: bool,
    pub region_ids: Val,
    pub moments: Vec<Moment>,
    pub mend: RefCell<Mend>,
    pub zone_skies: RefCell<Option<(String, Vec<ZoneSky>)>>,
    pub zone_neighbours: RefCell<Option<Vec<Vec<usize>>>>,
    pub lines: RefCell<Option<Vec<WallLine>>>,
    pub air_day: Cell<Option<f64>>,
    pub air_over: RefCell<Vec<(usize, [Vec<String>; 2])>>,
    pub wings: RefCell<Option<OrdMap<String, Wing>>>,
    pub arenas: HashMap<String, Rc<Arena>>,
    pub cache_on: bool,
    pub kept_flags: HashSet<String>,
    pub kept_lists: HashMap<String, Val>,
    pub grids: HashMap<String, WorldGrid>,
    pub land_regions: Option<Rc<Vec<Val>>>,
    pub captures_refused: Vec<String>,
    pub spare: Option<Battle>,
    dated: bool,
    from_date: String,
    controller: OrdMap<String, String>,
    group: OrdMap<String, String>,
    areas: Rc<Val>,
    figures: RefCell<OrdMap<String, Military>>,
    curves: RefCell<OrdMap<String, Val>>,
}

pub fn create_run(input: Val, hooks: Box<dyn Hooks>) -> Run {
    let days = jsmath::max(0.0, js::or_zero(input.get("days").num()).floor());
    let from_date = input.get("fromDate").string_or_empty();
    let dated = !add_game_days(&from_date, 0.0).is_empty();
    let era_given = match input.get("era") {
        Val::Num(n) if n.is_finite() && n.trunc() == *n => Some(*n),
        _ => None,
    };
    let era = era_of(&from_date, era_given);
    let areas = if input.get("groupAreas").truthy() && input.get("groupAreas").is_object() { input.get("groupAreas").clone() } else { Val::Obj(js::Obj::new()) };
    let men_each = if input.get("menEach").num() >= 1.0 { jsmath::round(input.get("menEach").num()) } else { men_per_formation(&Val::Num(era as f64)).unwrap_or(f64::NAN) };
    let share = input.get("manpowerShare").num();
    let flip_allowance = match input.get("flipAllowance") {
        Val::Num(n) if n.is_finite() => jsmath::max(0.0, n.floor()),
        _ => f64::INFINITY,
    };
    let mut run = Run {
        days,
        day: 0.0,
        steps: 0.0,
        era,
        mech: read_mechanics(input.get("mechanics")),
        warfare: if matches!(input.get("warfare"), Val::Str(form) if form == SWARM_FORM) { SWARM_FORM.to_string() } else { "front".to_string() },
        seed: input.get("seed").string_or_empty(),
        troops: troops_factor(input.get("troops").num()),
        men_each,
        manpower_share: if share > 0.0 && share <= 100.0 { share / 100.0 } else { 0.0 },
        manpower: RefCell::new(OrdMap::new()),
        effort: OrdMap::new(),
        pace: jsmath::min(3.0, jsmath::max(0.1, { let pace = input.get("pace").num(); if pace.is_nan() || pace == 0.0 { 1.0 } else { pace } })),
        steer: if input.get("steering").truthy() && input.get("steering").is_object() { input.get("steering").clone() } else { Val::Obj(js::Obj::new()) },
        advance_km: [ADVANCE_KM_PER_DAY[0][era], ADVANCE_KM_PER_DAY[1][era], ADVANCE_KM_PER_DAY[2][era]],
        overland_km: [OVERLAND_KM_PER_DAY[0][era], OVERLAND_KM_PER_DAY[1][era], OVERLAND_KM_PER_DAY[2][era]],
        battles: Vec::new(),
        wars: OrdMap::new(),
        flips: Vec::new(),
        joins: Vec::new(),
        starts: Vec::new(),
        transports: Vec::new(),
        voyages: Vec::new(),
        unit_changes: Vec::new(),
        notes: Vec::new(),
        taken: Vec::new(),
        cursor: 0.0,
        flips_left: flip_allowance,
        braked: false,
        region_ids: Val::Null,
        moments: Vec::new(),
        mend: RefCell::new(Mend::default()),
        zone_skies: RefCell::new(None),
        zone_neighbours: RefCell::new(None),
        lines: RefCell::new(None),
        air_day: Cell::new(None),
        air_over: RefCell::new(Vec::new()),
        wings: RefCell::new(None),
        arenas: HashMap::new(),
        cache_on: false,
        kept_flags: HashSet::new(),
        kept_lists: HashMap::new(),
        grids: HashMap::new(),
        land_regions: None,
        captures_refused: Vec::new(),
        spare: None,
        dated,
        from_date,
        controller: OrdMap::new(),
        group: OrdMap::new(),
        areas: Rc::new(areas),
        figures: RefCell::new(OrdMap::new()),
        curves: RefCell::new(OrdMap::new()),
        input: Rc::new(Val::Null),
        hooks: Rc::from(hooks),
        staff_policy: None,
        rehearsing: false,
    };
    if run.flips_left <= 0.0 {
        run.braked = true;
    }
    if let Val::Map(entries) = input.get("arenas") {
        run.cache_on = true;
        for (key, value) in entries {
            let Val::Str(key) = key else { continue };
            match value {
                Val::Bool(true) => {
                    run.kept_flags.insert(key.clone());
                }
                Val::Arr(_) => {
                    run.kept_lists.insert(key.clone(), value.clone());
                }
                _ => {}
            }
        }
    }
    for war in input.get("wars").array_or_empty() {
        let id = clean(war.get("id"), 120);
        if id.is_empty() || run.wars.has(&id) {
            continue;
        }
        let status = match war.get("status") {
            Val::Str(status) if ["active", "ceasefire", "ended"].contains(&status.as_str()) => status.clone(),
            _ => "active".to_string(),
        };
        run.wars.set(
            id.clone(),
            War { id, title: clean(war.get("title"), 120), status, sides: [member_list(war.get("sideA")), member_list(war.get("sideB"))], began: clean(war.get("startedDate"), 120) },
        );
    }
    let mut moments: Vec<Moment> = input
        .get("moments")
        .array_or_empty()
        .iter()
        .filter(|moment| moment.truthy() && moment.is_object())
        .enumerate()
        .map(|(index, moment)| Moment { moment: moment.clone(), index, day: jsmath::min(days, jsmath::max(0.0, js::or_zero(moment.get("day").num()).floor())) })
        .collect();
    js::stable_sort_by(&mut moments, |a, b| {
        let by_day = a.day - b.day;
        if by_day != 0.0 {
            by_day
        } else {
            a.index as f64 - b.index as f64
        }
    });
    run.moments = moments;
    run.input = Rc::new(input);
    run
}

impl Run {
    pub fn date_of(&self, day: f64) -> String {
        if self.dated {
            add_game_days(&self.from_date, day)
        } else if day >= self.days && self.input.get("toDate").truthy() {
            self.input.get("toDate").string()
        } else {
            self.from_date.clone()
        }
    }

    pub fn controller_of(&self, id: &str) -> String {
        match self.controller.get(&id.to_string()) {
            Some(name) => name.clone(),
            None => clean(&self.hooks.controller_of(id), 120),
        }
    }

    pub fn sovereign_of(&self, id: &str) -> String {
        clean(&self.hooks.sovereign_of(id), 120)
    }

    pub fn group_of(&self, id: &str) -> String {
        match self.group.get(&id.to_string()) {
            Some(name) => name.clone(),
            None => clean(self.areas.get(id), 120),
        }
    }

    pub fn is_group(&self, name: &str) -> bool {
        self.hooks.is_group(name).is_true()
    }

    pub fn strength_of(&self, name: &str) -> f64 {
        let weight = self.hooks.strength_of(name).num();
        if weight > 0.0 && weight.is_finite() {
            weight
        } else {
            1.0
        }
    }

    pub fn shortage_of(&self, name: &str) -> f64 {
        let short = self.hooks.shortage_of(name).num();
        if short > 0.0 && short.is_finite() {
            if short > 1.0 {
                1.0
            } else {
                short
            }
        } else {
            0.0
        }
    }

    pub fn set_controller(&mut self, id: &str, name: &str) {
        self.controller.set(id.to_string(), clean_text(name, 120));
    }

    pub fn set_group(&mut self, id: &str, name: &str) {
        self.group.set(id.to_string(), clean_text(name, 120));
    }

    pub fn military_of(&self, name: &str) -> Military {
        if !self.mech.military() {
            return MILITARY_NEUTRAL;
        }
        let key = fold_text(name);
        if let Some(known) = self.figures.borrow().get(&key) {
            return *known;
        }
        let figures = read_military(&self.hooks.military_of(name));
        self.figures.borrow_mut().set(key, figures);
        figures
    }

    pub fn muster_of(&self, name: &str) -> Val {
        if !self.mech.muster() {
            return Val::Null;
        }
        let key = fold_text(name);
        if let Some(known) = self.curves.borrow().get(&key) {
            return known.clone();
        }
        let curve = self.hooks.muster_of(name);
        let kept = if curve.truthy() && curve.get("table").as_array().is_some() { curve } else { Val::Null };
        self.curves.borrow_mut().set(key, kept.clone());
        kept
    }

    pub fn lend(&mut self, at: usize) -> Battle {
        let hollow = match self.spare.take() {
            Some(hollow) => hollow,
            None => {
                let model = &self.battles[at];
                let mut hollow = create_battle(self, Opening { name: String::new(), war_id: Val::Null, sides: [Vec::new(), Vec::new()], frame: model.frame.clone(), arena: model.arena.clone(), opened_date: Val::Null, opened_day: Val::Null });
                hollow.status = "closed".to_string();
                hollow
            }
        };
        std::mem::replace(&mut self.battles[at], hollow)
    }

    pub fn give(&mut self, at: usize, battle: Battle) {
        let hollow = std::mem::replace(&mut self.battles[at], battle);
        self.spare = Some(hollow);
    }

    pub fn stub(&self, copy: Battle) -> Run {
        Run {
            input: self.input.clone(),
            hooks: self.hooks.clone(),
            staff_policy: None,
            rehearsing: true,
            days: self.days,
            day: self.day,
            steps: 0.0,
            era: self.era,
            mech: self.mech,
            warfare: self.warfare.clone(),
            seed: self.seed.clone(),
            troops: self.troops,
            men_each: self.men_each,
            manpower_share: self.manpower_share,
            manpower: RefCell::new(self.manpower.borrow().clone()),
            effort: OrdMap::new(),
            pace: self.pace,
            steer: self.steer.clone(),
            advance_km: self.advance_km,
            overland_km: self.overland_km,
            battles: vec![copy],
            wars: self.wars.clone(),
            flips: Vec::new(),
            joins: Vec::new(),
            starts: Vec::new(),
            transports: self.transports.clone(),
            voyages: Vec::new(),
            unit_changes: Vec::new(),
            notes: Vec::new(),
            taken: self.taken.clone(),
            cursor: self.cursor,
            flips_left: f64::INFINITY,
            braked: false,
            region_ids: Val::Null,
            moments: Vec::new(),
            mend: RefCell::new(self.mend.borrow().clone()),
            zone_skies: RefCell::new(self.zone_skies.borrow().clone()),
            zone_neighbours: RefCell::new(self.zone_neighbours.borrow().clone()),
            lines: RefCell::new(self.lines.borrow().clone()),
            air_day: Cell::new(None),
            air_over: RefCell::new(Vec::new()),
            wings: RefCell::new(self.wings.borrow().clone()),
            arenas: HashMap::new(),
            cache_on: self.cache_on,
            kept_flags: HashSet::new(),
            kept_lists: HashMap::new(),
            grids: HashMap::new(),
            land_regions: self.land_regions.clone(),
            captures_refused: Vec::new(),
            spare: None,
            dated: self.dated,
            from_date: self.from_date.clone(),
            controller: self.controller.clone(),
            group: self.group.clone(),
            areas: self.areas.clone(),
            figures: RefCell::new(self.figures.borrow().clone()),
            curves: RefCell::new(self.curves.borrow().clone()),
        }
    }

    pub fn spend_flip(&mut self) {
        if self.rehearsing {
            return;
        }
        self.flips_left -= 1.0;
        if self.flips_left > 0.0 || self.braked {
            return;
        }
        self.braked = true;
        self.notes.push(Val::obj([("kind", Val::str("tempo"))]));
    }
}
