use super::features::{staff_features, FEATURE_COUNT, MIND_ACTIONS, SEEN_COUNT};
use super::net::{head_step, step, Shape};
use super::troops::{troop_view, DIG_IN, HOLD, PUSH, REST, TROOP_ACTIONS, TROOP_FEATURE_COUNT};
use crate::jsmath;
use crate::sim::battle::Battle;
use crate::sim::engine::{create_run, NoHooks, Run};
use crate::sim::js::{self, Obj, OrdMap, Val};
use crate::sim::staff::Today;

pub const MIND_OUTPUTS: usize = MIND_ACTIONS.len() + 2;
pub const MIND_SHAPE: Shape = Shape::side(FEATURE_COUNT, 12, MIND_OUTPUTS);
pub const TROOP_SHAPE: Shape = Shape { inputs: FEATURE_COUNT as f64, hidden: 12.0, outputs: TROOP_ACTIONS.len() as f64, head: TROOP_FEATURE_COUNT as f64, head_hidden: 16.0 };
pub const MIND_ORDERS_MOST: usize = 12;

pub struct Context<'a> {
    pub began: bool,
    pub today: Option<&'a Today<'a>>,
    pub key: &'a str,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StaffChoice {
    pub order: String,
    pub sector: String,
    pub draft: bool,
    pub action: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TroopOrder {
    pub order: String,
    pub picked: Vec<usize>,
    pub way: Option<Vec<[f64; 2]>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TroopChoice {
    pub troops: Vec<TroopOrder>,
    pub said: Vec<f64>,
}

fn round(value: f64) -> f64 {
    jsmath::round(value * 1e4) / 1e4
}

struct Memory {
    state: Vec<f64>,
    seen: Option<Vec<f64>>,
}

fn recall(battle: &Battle, side: usize, hidden: usize) -> Memory {
    let mut state = vec![0.0; hidden];
    let kept = match battle.mind.at(side) {
        Val::Arr(list) => Some(list),
        _ => None,
    };
    match kept {
        Some(kept) if kept.len() == hidden + SEEN_COUNT => {
            for (at, slot) in state.iter_mut().enumerate() {
                *slot = js::or_zero(js::to_number(&kept[at]));
            }
            Memory { state, seen: Some(kept[hidden..].iter().map(|value| js::or_zero(js::to_number(value))).collect()) }
        }
        _ => Memory { state, seen: None },
    }
}

fn remember(battle: &mut Battle, side: usize, state: &[f64], seen: &[f64]) {
    if battle.mind.as_array().is_none() {
        battle.mind = Val::Arr(vec![Val::Arr(Vec::new()), Val::Arr(Vec::new())]);
    }
    let kept = Val::Arr(state.iter().chain(seen.iter()).map(|&value| Val::Num(round(value))).collect());
    if let Val::Arr(list) = &mut battle.mind {
        while list.len() <= side {
            list.push(Val::Undef);
        }
        list[side] = kept;
    }
}

pub struct StaffPolicy {
    shape: Shape,
    params: Vec<f64>,
    prior: f64,
    drafts: bool,
    fits: bool,
}

pub fn create_staff_policy(shape: Shape, params: Vec<f64>, prior: f64, drafts: bool) -> StaffPolicy {
    let fits = shape.inputs == FEATURE_COUNT as f64 && shape.outputs == MIND_OUTPUTS as f64;
    StaffPolicy { shape, params, prior, drafts, fits }
}

impl StaffPolicy {
    pub fn decide(&self, battle: &mut Battle, side: usize, context: &Context, run: Option<&Run>, me: Option<usize>) -> Option<StaffChoice> {
        if !self.fits {
            return None;
        }
        let memory = recall(battle, side, self.shape.hidden as usize);
        let look = staff_features(battle, side, context.began, context.today, context.key, run, me, memory.seen.as_deref());
        let stepped = step(&self.shape, &self.params, &memory.state, &look.x);
        remember(battle, side, &stepped.state, &look.seen);
        let out = &stepped.out;
        let mut chosen = 0;
        let mut most = f64::NEG_INFINITY;
        for at in 0..MIND_ACTIONS.len() {
            let value = out[at] + if at == look.staff { self.prior } else { 0.0 };
            if value > most {
                most = value;
                chosen = at;
            }
        }
        let word = MIND_ACTIONS[chosen];
        let draft = self.drafts && out[MIND_ACTIONS.len() + 1] > out[MIND_ACTIONS.len()];
        if word == "probe" {
            return Some(StaffChoice { order: "advance".to_string(), sector: if look.best.is_empty() { "all".to_string() } else { look.best.clone() }, draft, action: chosen });
        }
        Some(StaffChoice { order: word.to_string(), sector: "all".to_string(), draft, action: chosen })
    }
}

pub struct TroopPolicy {
    shape: Shape,
    params: Vec<f64>,
    fits: bool,
}

fn same_shape(a: &Shape, b: &Shape) -> bool {
    let same = |x: f64, y: f64| x == y || (x.is_nan() && y.is_nan());
    a.inputs == b.inputs && a.hidden == b.hidden && a.outputs == b.outputs && same(a.head, b.head) && same(a.head_hidden, b.head_hidden)
}

pub fn create_troop_policy(shape: Shape, params: Vec<f64>) -> TroopPolicy {
    TroopPolicy { fits: same_shape(&shape, &TROOP_SHAPE), shape, params }
}

impl TroopPolicy {
    pub fn decide(&self, battle: &mut Battle, side: usize, context: &Context, run: Option<&Run>, me: Option<usize>) -> Option<TroopChoice> {
        if !self.fits {
            return None;
        }
        let memory = recall(battle, side, self.shape.hidden as usize);
        let look = staff_features(battle, side, context.began, context.today, context.key, run, me, memory.seen.as_deref());
        let stepped = step(&self.shape, &self.params, &memory.state, &look.x);
        remember(battle, side, &stepped.state, &look.seen);
        let bare;
        let viewer = match run {
            Some(run) => run,
            None => {
                bare = create_run(Val::Obj(Obj::new()), Box::new(NoHooks));
                &bare
            }
        };
        let view = troop_view(viewer, battle, side);
        let mut said = vec![0.0; TROOP_ACTIONS.len()];
        let mut bodies: OrdMap<String, Vec<usize>> = OrdMap::new();
        for row in &view.rows {
            let scores = head_step(&self.shape, &self.params, &stepped.state, Some(&stepped.out), &row.t);
            let mut chosen = HOLD;
            let mut most = f64::NEG_INFINITY;
            for at in 0..TROOP_ACTIONS.len() {
                if !row.valid[at] || !(scores[at] > most) {
                    continue;
                }
                most = scores[at];
                chosen = at;
            }
            said[chosen] += 1.0;
            let key = if chosen == HOLD {
                "hold".to_string()
            } else if chosen == DIG_IN {
                "dig in".to_string()
            } else if chosen == PUSH {
                "push".to_string()
            } else if chosen == REST {
                "rest".to_string()
            } else {
                row.goal[chosen].clone()
            };
            if !bodies.has(&key) {
                bodies.set(key.clone(), Vec::new());
            }
            bodies.get_mut(&key).unwrap().push(row.index);
        }
        let mut sent: Vec<(String, usize)> = bodies.entries.iter().filter(|(key, _)| key != "hold" && key != "dig in").map(|(key, picked)| (key.clone(), picked.len())).collect();
        js::stable_sort_by(&mut sent, |a, b| {
            let by_count = b.1 as f64 - a.1 as f64;
            if by_count != 0.0 {
                by_count
            } else {
                match js::compare_units(&a.0, &b.0) {
                    std::cmp::Ordering::Less => -1.0,
                    std::cmp::Ordering::Greater => 1.0,
                    std::cmp::Ordering::Equal => 0.0,
                }
            }
        });
        let mut hold = bodies.get(&"hold".to_string()).cloned().unwrap_or_default();
        for (key, _) in sent.iter().skip(MIND_ORDERS_MOST) {
            let picked = bodies.remove(key).unwrap_or_default();
            hold.extend(picked);
        }
        if !hold.is_empty() {
            bodies.set("hold".to_string(), hold);
        }
        let mut troops = Vec::new();
        for (key, picked) in &bodies.entries {
            let mut picked = picked.clone();
            picked.sort();
            if key == "hold" || key == "dig in" {
                troops.push(TroopOrder { order: key.clone(), picked, way: None });
            } else if key == "push" {
                troops.push(TroopOrder { order: "advance".to_string(), picked, way: None });
            } else if key == "rest" {
                troops.push(TroopOrder { order: "rest".to_string(), picked, way: None });
            } else {
                let way: Vec<[f64; 2]> = view.places.get(key).map(|way| way.iter().map(|&[x, y]| {
                    let [lng, lat] = battle.place.to_lng_lat(x, y);
                    [jsmath::round(lng * 10000.0) / 10000.0, jsmath::round(lat * 10000.0) / 10000.0]
                }).collect()).unwrap_or_default();
                if !way.is_empty() {
                    troops.push(TroopOrder { order: "advance".to_string(), picked, way: Some(way) });
                }
            }
        }
        Some(TroopChoice { troops, said })
    }
}
