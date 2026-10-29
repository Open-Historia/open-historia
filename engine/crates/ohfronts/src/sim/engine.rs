use super::air::Wing;
use super::battle::Battle;
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
use std::cell::{Cell, RefCell};

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
    pub input: Val,
    pub hooks: Box<dyn Hooks>,
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
    pub effort: OrdMap<String, Val>,
    pub pace: f64,
    pub steer: Val,
    pub advance_km: [f64; 3],
    pub overland_km: [f64; 3],
    pub battles: Vec<Battle>,
    pub wars: OrdMap<String, War>,
    pub flips: Vec<Val>,
    pub joins: Vec<Val>,
    pub starts: Vec<Val>,
    pub transports: Vec<Val>,
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
    dated: bool,
    from_date: String,
    controller: OrdMap<String, String>,
    group: OrdMap<String, String>,
    areas: Val,
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
        dated,
        from_date,
        controller: OrdMap::new(),
        group: OrdMap::new(),
        areas,
        figures: RefCell::new(OrdMap::new()),
        curves: RefCell::new(OrdMap::new()),
        input: Val::Null,
        hooks,
    };
    if run.flips_left <= 0.0 {
        run.braked = true;
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
    run.input = input;
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

    pub fn spend_flip(&mut self) {
        self.flips_left -= 1.0;
        if self.flips_left > 0.0 || self.braked {
            return;
        }
        self.braked = true;
        self.notes.push(Val::obj([("kind", Val::str("tempo"))]));
    }
}
