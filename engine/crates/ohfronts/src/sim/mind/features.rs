use crate::sim::battle::Battle;
use crate::sim::constants::{POOL_PER_TROOP, STAFF_SECTOR_TROOPS_LEAST};
use crate::sim::engine::Run;
use crate::sim::js::{self, Val};
use crate::sim::sectors::{in_sector, resolve_sector, Sector};
use crate::sim::staff::{attack_of, fold_value, staff_decision, Today};
use crate::sim::troops::{is_live, Troop, STATE_DUG_IN};

pub const MIND_ACTIONS: [&str; 4] = ["dig in", "hold", "probe", "advance"];

pub const FEATURE_NAMES: [&str; 28] = [
    "one",
    "odds",
    "odds on its best stretch",
    "odds on its worst stretch",
    "own troops",
    "their troops",
    "own strength",
    "their strength",
    "own reserves",
    "their reserves",
    "own supply",
    "their supply",
    "own cut off",
    "their cut off",
    "own dug in",
    "home ground lost",
    "their ground taken",
    "home ground lost since last look",
    "their ground taken since last look",
    "odds since last look",
    "began the war",
    "days fought",
    "home ground lost elsewhere",
    "share of its strength here",
    "staff: dig in",
    "staff: hold",
    "staff: probe",
    "staff: advance",
];
pub const FEATURE_COUNT: usize = FEATURE_NAMES.len();
pub const SEEN_COUNT: usize = 3;

fn within(value: f64, least: f64, most: f64) -> f64 {
    if value < least {
        least
    } else if value > most {
        most
    } else {
        value
    }
}

fn share(ratio: f64) -> f64 {
    ratio / (1.0 + ratio)
}

struct Weighed {
    worth: f64,
    count: f64,
    strength: f64,
    supply: f64,
    cut: f64,
    dug: f64,
}

fn weigh(battle: &Battle, side: usize, inside: Option<&dyn Fn(&Troop) -> bool>) -> Weighed {
    let mut out = Weighed { worth: 0.0, count: 0.0, strength: 0.0, supply: 0.0, cut: 0.0, dug: 0.0 };
    for troop in &battle.troops[side] {
        if !is_live(troop) || inside.is_some_and(|inside| !inside(troop)) {
            continue;
        }
        out.worth += troop.strength * attack_of(troop.kind) * troop.supply * troop.punch;
        out.strength += troop.strength;
        out.supply += troop.supply;
        out.count += 1.0;
        if troop.pocket {
            out.cut += 1.0;
        }
        if troop.state == STATE_DUG_IN {
            out.dug += 1.0;
        }
    }
    out.worth = out.worth * battle.quality[side] * battle.edge[side].power;
    out
}

pub fn home_table_of(battle: &Battle, run: Option<&Run>) -> Option<Vec<i32>> {
    let holders = &battle.field.as_ref()?.holders;
    if let Some(known) = battle.mind_homes.borrow().as_ref() {
        if known.len() == holders.len() {
            return Some(known.iter().map(|&home| home as i32).collect());
        }
    }
    let run = match run {
        Some(run) => run,
        None => return battle.homes.as_ref().map(|homes| homes.iter().map(|&home| home as i32).collect()),
    };
    let arena = &battle.arena;
    let members: Vec<Vec<String>> = battle.sides.iter().map(|names| names.iter().map(|name| fold_value(&Val::str(name))).collect()).collect();
    let mut side_of_region = vec![-1i8; arena.ids.len()];
    for region in 1..arena.ids.len() {
        let sovereign = fold_value(&Val::Str(run.sovereign_of(&arena.ids[region])));
        if sovereign.is_empty() {
            continue;
        }
        if members[0].contains(&sovereign) {
            side_of_region[region] = 0;
        } else if members[1].contains(&sovereign) {
            side_of_region[region] = 1;
        }
    }
    let table: Vec<i8> = (0..holders.len()).map(|cell| arena.region.get(cell).and_then(|&region| side_of_region.get(region as usize)).copied().unwrap_or(0)).collect();
    let out = table.iter().map(|&home| home as i32).collect();
    *battle.mind_homes.borrow_mut() = Some(table);
    Some(out)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ground {
    pub lost: f64,
    pub taken: f64,
}

pub fn count_ground(holders: Option<&[u8]>, homes: Option<&[i32]>, side: usize) -> Ground {
    let (holders, homes) = match (holders, homes) {
        (Some(holders), Some(homes)) => (holders, homes),
        _ => return Ground { lost: 0.0, taken: 0.0 },
    };
    let other = 1 - side;
    let (mut home, mut lost, mut theirs, mut taken) = (0.0, 0.0, 0.0, 0.0);
    for cell in 0..holders.len() {
        let owner = homes.get(cell).copied();
        if owner == Some(side as i32) {
            home += 1.0;
            if holders[cell] as usize == other {
                lost += 1.0;
            }
        } else if owner == Some(other as i32) {
            theirs += 1.0;
            if holders[cell] as usize == side {
                taken += 1.0;
            }
        }
    }
    Ground { lost: if home > 0.0 { lost / home } else { 0.0 }, taken: if theirs > 0.0 { taken / theirs } else { 0.0 } }
}

pub fn ground_of(battle: &Battle, side: usize, run: Option<&Run>) -> Ground {
    let homes = home_table_of(battle, run);
    count_ground(battle.field.as_ref().map(|field| field.holders.as_slice()), homes.as_deref(), side)
}

#[derive(Clone, Debug, PartialEq)]
pub struct Look {
    pub x: Vec<f64>,
    pub best: String,
    pub staff: usize,
    pub seen: [f64; 3],
}

pub fn staff_features(battle: &Battle, side: usize, began: bool, today: Option<&Today>, key: &str, run: Option<&Run>, me: Option<usize>, seen: Option<&[f64]>) -> Look {
    let own = weigh(battle, side, None);
    let theirs = weigh(battle, 1 - side, None);
    let odds = if theirs.worth > 0.0 {
        share(own.worth / theirs.worth)
    } else if own.worth > 0.0 {
        1.0
    } else {
        0.5
    };
    let mut best = String::new();
    let mut best_odds = -1.0;
    let mut worst_odds = 2.0;
    let names: &[String] = today.and_then(|today| today.sectors).map(|sectors| sectors.names.as_slice()).unwrap_or(&[]);
    for name in names {
        let today = today.unwrap();
        let sector = match resolve_sector(&battle.arena, today.contour, today.count, today.sectors.unwrap(), &Val::str(name)) {
            Some(sector) if sector != Sector::All => sector,
            _ => continue,
        };
        let place = &battle.place;
        let inside = |troop: &Troop| in_sector(&sector, troop.x, troop.y, |y| place.km_at(y));
        let mine = weigh(battle, side, Some(&inside));
        if mine.count < STAFF_SECTOR_TROOPS_LEAST {
            continue;
        }
        let facing = weigh(battle, 1 - side, Some(&inside));
        let there = if facing.worth > 0.0 { share(mine.worth / facing.worth) } else { 1.0 };
        if there > best_odds {
            best_odds = there;
            best = name.clone();
        }
        if there < worst_odds {
            worst_odds = there;
        }
    }
    if best_odds < 0.0 {
        best_odds = odds;
    }
    if worst_odds > 1.0 {
        worst_odds = odds;
    }
    let ground = ground_of(battle, side, run);
    let before: [f64; 3] = match seen {
        Some(seen) if seen.len() >= SEEN_COUNT => [seen[0], seen[1], seen[2]],
        _ => [ground.lost, ground.taken, odds],
    };
    let mut elsewhere_lost = 0.0;
    let mut here = 1.0;
    if let Some(run) = run {
        let mut other = 0.0;
        let members: Vec<String> = battle.sides[side].iter().enumerate().filter(|(at, _)| !battle.gone[side].contains(at)).map(|(_, member)| fold_value(&Val::str(member))).collect();
        for (index, front) in run.battles.iter().enumerate() {
            if Some(index) == me || front.status == "closed" {
                continue;
            }
            let at = (0..2).find(|&at| front.sides[at].iter().enumerate().any(|(slot, member)| !front.gone[at].contains(&slot) && members.contains(&fold_value(&Val::str(member)))));
            let at = match at {
                Some(at) => at,
                None => continue,
            };
            other += js::or_zero(front.line_km);
            let lost = ground_of(front, at, Some(run)).lost;
            if lost > elsewhere_lost {
                elsewhere_lost = lost;
            }
        }
        let line = js::or_zero(battle.line_km);
        here = if line + other > 0.0 { line / (line + other) } else { 1.0 };
    }
    let scripted = staff_decision(battle, side, began, today, key);
    let staff = match &scripted {
        None => 1,
        Some(decision) if decision.order == "dig in" => 0,
        Some(decision) if decision.order == "hold" => 1,
        Some(decision) if decision.sector == "all" => 3,
        Some(_) => 2,
    };
    let mean = |sum: f64, count: f64, none: f64| if count > 0.0 { sum / count } else { none };
    let reserve = |index: usize, count: f64| if count > 0.0 { within(js::or_zero(battle.pool[index]) / (count * POOL_PER_TROOP), 0.0, 2.0) / 2.0 } else { 0.0 };
    let mut x = vec![0.0; FEATURE_COUNT];
    x[0] = 1.0;
    x[1] = odds;
    x[2] = best_odds;
    x[3] = worst_odds;
    x[4] = within(own.count / 40.0, 0.0, 1.0);
    x[5] = within(theirs.count / 40.0, 0.0, 1.0);
    x[6] = mean(own.strength, own.count, 0.0) / 100.0;
    x[7] = mean(theirs.strength, theirs.count, 0.0) / 100.0;
    x[8] = reserve(side, own.count);
    x[9] = reserve(1 - side, theirs.count);
    x[10] = mean(own.supply, own.count, 1.0);
    x[11] = mean(theirs.supply, theirs.count, 1.0);
    x[12] = mean(own.cut, own.count, 0.0);
    x[13] = mean(theirs.cut, theirs.count, 0.0);
    x[14] = mean(own.dug, own.count, 0.0);
    x[15] = ground.lost;
    x[16] = ground.taken;
    x[17] = within((ground.lost - before[0]) * 5.0, -1.0, 1.0);
    x[18] = within((ground.taken - before[1]) * 5.0, -1.0, 1.0);
    x[19] = within((odds - before[2]) * 5.0, -1.0, 1.0);
    x[20] = if began { 1.0 } else { 0.0 };
    x[21] = within(js::or_zero(battle.days_run) / 180.0, 0.0, 1.0);
    x[22] = elsewhere_lost;
    x[23] = here;
    x[24 + staff] = 1.0;
    Look { x, best, staff, seen: [ground.lost, ground.taken, odds] }
}
