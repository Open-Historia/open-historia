use crate::sim::arena::City;
use crate::sim::battle::Battle;
use crate::sim::engine::Run;
use crate::sim::field::{read_field, Field};
use crate::sim::frame::Projector;
use crate::sim::ground::cell_at;
use crate::sim::js::{self, OrdMap, Val};
use crate::sim::staff::attack_of;
use crate::sim::troops::{is_live, or_else, Troop, KIND_ARMOUR, KIND_ARTILLERY, STATE_DUG_IN};

pub const TROOP_ACTIONS: [&str; 11] = ["hold", "dig in", "push", "strike", "go round", "take a city", "take a capital", "guard a city", "shore up", "rest", "breach"];
pub const HOLD: usize = 0;
pub const DIG_IN: usize = 1;
pub const PUSH: usize = 2;
pub const STRIKE: usize = 3;
pub const GO_ROUND: usize = 4;
pub const TAKE_CITY: usize = 5;
pub const TAKE_CAPITAL: usize = 6;
pub const GUARD: usize = 7;
pub const SHORE_UP: usize = 8;
pub const REST: usize = 9;
pub const BREACH: usize = 10;

pub const TROOP_FEATURE_NAMES: [&str; 34] = [
    "one",
    "strength",
    "armour",
    "artillery",
    "supply",
    "cut off",
    "dug in",
    "depth behind its line",
    "odds round it",
    "its own round it",
    "theirs round it",
    "strike: how far",
    "strike: odds there",
    "go round: how far",
    "go round: how many there",
    "city: how far",
    "city: worth",
    "city: how held",
    "capital: how far",
    "capital: how held",
    "guard: how far",
    "guard: danger",
    "guard: worth",
    "shore up: how far",
    "shore up: odds there",
    "how far back it stands among its own",
    "attacking now",
    "at a city of its own",
    "fatigue",
    "breach: how far",
    "breach: wall's level",
    "today's going",
    "the sky over it",
    "still mustering",
];
pub const TROOP_FEATURE_COUNT: usize = TROOP_FEATURE_NAMES.len();

pub const LOCAL_KM: f64 = 50.0;
pub const CITY_KM: f64 = 60.0;
pub const REACH_MOST_KM: f64 = 250.0;
pub const SPOTS_MOST: usize = 4;
pub const MASSES_MOST: usize = 2;
pub const GUARDED_MOST: usize = 3;
const THROUGH_KM: f64 = 15.0;
const PAST_KM: f64 = 45.0;
const BEHIND_KM: f64 = 45.0;
const HERE_KM: f64 = 10.0;
const FRONT_CELLS: f64 = 6.0;
const LARGE_TOWN: f64 = 100000.0;

fn within(value: f64, least: f64, most: f64) -> f64 {
    if value < least {
        least
    } else if value > most {
        most
    } else {
        value
    }
}

pub fn city_worth(city: &City) -> f64 {
    if city.capital {
        3.0
    } else if js::or_zero(city.population) >= LARGE_TOWN {
        2.0
    } else {
        1.0
    }
}

fn or_one(value: f64) -> f64 {
    if value.is_nan() || value == 0.0 {
        1.0
    } else {
        value
    }
}

struct Point<'a> {
    index: usize,
    troop: &'a Troop,
    x: f64,
    y: f64,
    worth: f64,
}

fn points_of(battle: &Battle, side: usize) -> Vec<Point<'_>> {
    let factor = or_one(battle.quality[side]) * or_one(battle.edge[side].power);
    battle.troops[side]
        .iter()
        .enumerate()
        .filter(|(_, troop)| is_live(troop))
        .map(|(index, troop)| Point { index, troop, x: troop.x, y: troop.y, worth: troop.strength * attack_of(troop.kind) * troop.supply * troop.punch * factor })
        .collect()
}

fn km_between(place: &Projector, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let km = place.km_at((ay + by) / 2.0);
    let dx = (ax - bx) * km;
    let dy = (ay - by) * km;
    (dx * dx + dy * dy).sqrt()
}

fn sum_near(points: &[Point], place: &Projector, x: f64, y: f64, km: f64) -> f64 {
    let mut sum = 0.0;
    for point in points {
        if km_between(place, point.x, point.y, x, y) <= km {
            sum += point.worth;
        }
    }
    sum
}

fn depth_of(field: &Field, side: usize, x: f64, y: f64) -> f64 {
    let phi = read_field(field, x, y);
    if side == 0 {
        -phi
    } else {
        phi
    }
}

fn into_theirs(field: &Field, side: usize, x: f64, y: f64, fallback: [f64; 2]) -> [f64; 2] {
    let mut gx = read_field(field, x + 1.0, y) - read_field(field, x - 1.0, y);
    let mut gy = read_field(field, x, y + 1.0) - read_field(field, x, y - 1.0);
    if side != 0 {
        gx = -gx;
        gy = -gy;
    }
    let length = (gx * gx + gy * gy).sqrt();
    if length > 1e-6 {
        [gx / length, gy / length]
    } else {
        fallback
    }
}

fn middle_of(points: &[Point]) -> [f64; 2] {
    let (mut x, mut y) = (0.0, 0.0);
    let count = points.len() as f64;
    for point in points {
        x += point.x / count;
        y += point.y / count;
    }
    [x, y]
}

#[derive(Clone, Debug)]
struct Spot {
    index: f64,
    x: f64,
    y: f64,
    score: f64,
    mine: f64,
    facing: f64,
    there: f64,
    level: f64,
    city: Option<CityAt>,
}

#[derive(Clone, Debug)]
struct CityAt {
    city: City,
    at: usize,
    held: f64,
    danger: f64,
}

fn spot(index: f64, x: f64, y: f64) -> Spot {
    Spot { index, x, y, score: 0.0, mine: 0.0, facing: 0.0, there: 0.0, level: 0.0, city: None }
}

fn spread(list: &[Spot], place: &Projector, apart: f64, most: usize) -> Vec<Spot> {
    let mut sorted = list.to_vec();
    js::stable_sort_by(&mut sorted, |a, b| or_else(b.score - a.score, || a.index - b.index));
    let mut taken: Vec<Spot> = Vec::new();
    for entry in sorted {
        if taken.len() >= most {
            break;
        }
        if taken.iter().any(|other| km_between(place, other.x, other.y, entry.x, entry.y) < apart) {
            continue;
        }
        taken.push(entry);
    }
    taken
}

fn nearest_of(places: &[Spot], place: &Projector, x: f64, y: f64, least: f64) -> Option<(usize, f64)> {
    let mut found: Option<(usize, f64)> = None;
    for (at, spot) in places.iter().enumerate() {
        let km = km_between(place, spot.x, spot.y, x, y);
        if km > REACH_MOST_KM || km < least {
            continue;
        }
        if found.is_none_or(|(_, known)| km < known) {
            found = Some((at, km));
        }
    }
    found
}

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub index: usize,
    pub t: Vec<f64>,
    pub valid: Vec<bool>,
    pub goal: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct View {
    pub rows: Vec<Row>,
    pub places: OrdMap<String, Vec<[f64; 2]>>,
}

fn odds(mine: f64, facing: f64) -> f64 {
    if mine + facing > 0.0 {
        mine / (mine + facing)
    } else {
        0.5
    }
}

pub fn troop_view(run: &Run, battle: &Battle, side: usize) -> View {
    let field = battle.field.as_ref().unwrap();
    let place = &battle.place;
    let other = 1 - side;
    let own = points_of(battle, side);
    let theirs = points_of(battle, other);
    let mut view = View::default();
    if own.is_empty() {
        return view;
    }
    let mut total = 0.0;
    for point in &own {
        total += point.worth;
    }
    let mean_own = total / own.len() as f64;
    let scale = 8.0 * (if mean_own > 0.0 { mean_own } else { 1.0 });
    let crowd = |worth: f64| worth / (worth + scale);
    let [own_x, own_y] = middle_of(&own);
    let [their_x, their_y] = if theirs.is_empty() { [own_x, own_y] } else { middle_of(&theirs) };
    let toward_length = ((their_x - own_x) * (their_x - own_x) + (their_y - own_y) * (their_y - own_y)).sqrt();
    let toward = if toward_length > 1e-6 { [(their_x - own_x) / toward_length, (their_y - own_y) / toward_length] } else { [if side == 0 { 1.0 } else { -1.0 }, 0.0] };
    let in_frame = |x: f64, y: f64| [within(x, 0.5, field.cols as f64 - 0.5), within(y, 0.5, field.rows as f64 - 0.5)];
    let along = |x: f64, y: f64, d: [f64; 2], km: f64| {
        let cells = km / place.km_at(y);
        in_frame(x + d[0] * cells, y + d[1] * cells)
    };
    let places = &mut view.places;

    let front: Vec<&Point> = theirs.iter().filter(|point| !point.troop.pocket && depth_of(field, other, point.x, point.y) <= FRONT_CELLS).collect();
    let pool: Vec<&Point> = if front.is_empty() { theirs.iter().collect() } else { front };
    let faced: Vec<Spot> = pool
        .iter()
        .map(|point| {
            let mut entry = spot(point.index as f64, point.x, point.y);
            entry.mine = sum_near(&own, place, point.x, point.y, LOCAL_KM);
            entry.facing = sum_near(&theirs, place, point.x, point.y, LOCAL_KM);
            entry
        })
        .collect();
    let weak = spread(&faced.iter().cloned().map(|mut entry| {
        entry.score = odds(entry.mine, entry.facing);
        entry
    }).collect::<Vec<_>>(), place, 2.0 * LOCAL_KM, SPOTS_MOST);
    for (at, spot) in weak.iter().enumerate() {
        let into = into_theirs(field, side, spot.x, spot.y, toward);
        places.set(format!("strike {at}"), vec![along(spot.x, spot.y, into, THROUGH_KM)]);
    }
    let masses = spread(&faced.iter().cloned().map(|mut entry| {
        entry.score = entry.facing;
        entry
    }).collect::<Vec<_>>(), place, 2.0 * LOCAL_KM, MASSES_MOST);
    let sideways: Vec<[f64; 2]> = masses
        .iter()
        .enumerate()
        .map(|(at, mass)| {
            let into = into_theirs(field, side, mass.x, mass.y, toward);
            let beside = [-into[1], into[0]];
            for sign in [1.0, -1.0] {
                let past = along(mass.x, mass.y, [beside[0] * sign, beside[1] * sign], PAST_KM);
                places.set(format!("round {at} {}", js::number_to_string(sign)), vec![past, along(mass.x, mass.y, into, BEHIND_KM)]);
            }
            beside
        })
        .collect();

    let cities: Vec<(City, usize, f64)> = battle
        .arena
        .cities
        .iter()
        .enumerate()
        .map(|(at, city)| {
            let cell = cell_at(field, city.x, city.y);
            (city.clone(), at, if cell >= 0 { field.holders[cell as usize] as f64 } else { -1.0 })
        })
        .collect();
    let to_take: Vec<Spot> = cities
        .iter()
        .filter(|(_, _, holder)| *holder == other as f64)
        .map(|(city, at, _)| {
            let mine = sum_near(&own, place, city.x, city.y, CITY_KM);
            let facing = sum_near(&theirs, place, city.x, city.y, CITY_KM);
            places.set(format!("city {at}"), vec![[city.x, city.y]]);
            let mut entry = spot(f64::NAN, city.x, city.y);
            entry.city = Some(CityAt { city: city.clone(), at: *at, held: 1.0 - odds(mine, facing), danger: 0.0 });
            entry
        })
        .collect();
    let capitals: Vec<Spot> = to_take.iter().filter(|entry| entry.city.as_ref().unwrap().city.capital).cloned().collect();
    let kept: Vec<Spot> = cities
        .iter()
        .filter(|(_, _, holder)| *holder == side as f64)
        .map(|(city, at, _)| {
            let mine = sum_near(&own, place, city.x, city.y, CITY_KM);
            let facing = sum_near(&theirs, place, city.x, city.y, CITY_KM);
            let danger = if facing > 0.0 { 1.0 - odds(mine, facing) } else { 0.0 };
            let mut entry = spot(*at as f64, city.x, city.y);
            entry.score = (danger + 0.1) * city_worth(city);
            entry.city = Some(CityAt { city: city.clone(), at: *at, held: 0.0, danger });
            entry
        })
        .collect();
    let guarded = spread(&kept, place, 0.0, GUARDED_MOST);
    for city in &guarded {
        places.set(format!("guard {}", city.city.as_ref().unwrap().at), vec![[city.x, city.y]]);
    }

    let own_front: Vec<Spot> = own
        .iter()
        .filter(|point| !point.troop.pocket && depth_of(field, side, point.x, point.y) <= FRONT_CELLS)
        .map(|point| {
            let mine = sum_near(&own, place, point.x, point.y, LOCAL_KM);
            let facing = sum_near(&theirs, place, point.x, point.y, LOCAL_KM);
            let mut entry = spot(point.index as f64, point.x, point.y);
            entry.there = odds(mine, facing);
            entry.score = if facing > 0.0 { 1.0 - odds(mine, facing) } else { 0.0 };
            entry
        })
        .filter(|entry| entry.score > 0.0)
        .collect();
    let shaky = spread(&own_front, place, 2.0 * LOCAL_KM, SPOTS_MOST);
    for (at, spot) in shaky.iter().enumerate() {
        places.set(format!("shore {at}"), vec![[spot.x, spot.y]]);
    }

    let mut wall_cells: Vec<Spot> = Vec::new();
    if let (Some(mask), Some(walls)) = (&battle.wall_mask[side], &battle.walls) {
        let lines = run.lines.borrow();
        for cell in 0..mask.len() {
            if mask[cell] != 1 {
                continue;
            }
            let at = walls.cell_line.get(cell).map(|&at| at as i64).unwrap_or(0);
            let level = if at > 0 && battle.wall_run { lines.as_ref().and_then(|lines| lines.get(at as usize - 1)).map(|line| line.level).unwrap_or(0.0) } else { 0.0 };
            let mut entry = spot(cell as f64, (cell % field.cols) as f64 + 0.5, (cell / field.cols) as f64 + 0.5);
            entry.level = level;
            entry.score = 10.0 - level;
            wall_cells.push(entry);
        }
    }
    let walls = spread(&wall_cells, place, 2.0 * LOCAL_KM, SPOTS_MOST);
    for (at, spot) in walls.iter().enumerate() {
        places.set(format!("breach {at}"), vec![[spot.x, spot.y]]);
    }
    let mut owed = 0.0;
    for entry in &battle.levy[side] {
        owed += if entry.t - entry.r > 0.0 { entry.t - entry.r } else { 0.0 };
    }
    let mustering = if owed > 0.0 { owed / (owed + own.len() as f64) } else { 0.0 };
    let sky = battle.wings.as_ref().map(|wings| (if wings.holds == side { 1.0 } else { -1.0 }) * wings.superiority).unwrap_or(0.0);

    let depths: Vec<f64> = own.iter().map(|point| depth_of(field, side, point.x, point.y)).collect();
    let mut order: Vec<usize> = (0..depths.len()).collect();
    js::stable_sort_by(&mut order, |&a, &b| or_else(depths[a] - depths[b], || a as f64 - b as f64));
    let mut rank = vec![0.0; own.len()];
    for (place_at, &at) in order.iter().enumerate() {
        rank[at] = if own.len() > 1 { place_at as f64 / (own.len() - 1) as f64 } else { 0.0 };
    }

    for (at, point) in own.iter().enumerate() {
        let troop = point.troop;
        let (x, y) = (point.x, point.y);
        let mine = sum_near(&own, place, x, y, LOCAL_KM);
        let facing = sum_near(&theirs, place, x, y, LOCAL_KM);
        let mut t = vec![0.0; TROOP_FEATURE_COUNT];
        let mut valid = vec![false; TROOP_ACTIONS.len()];
        let mut goal = vec![String::new(); TROOP_ACTIONS.len()];
        valid[HOLD] = true;
        valid[DIG_IN] = true;
        valid[PUSH] = !troop.pocket;
        t[0] = 1.0;
        t[1] = within(troop.strength / 100.0, 0.0, 1.5);
        t[2] = if troop.kind == KIND_ARMOUR { 1.0 } else { 0.0 };
        t[3] = if troop.kind == KIND_ARTILLERY { 1.0 } else { 0.0 };
        t[4] = troop.supply;
        t[5] = if troop.pocket { 1.0 } else { 0.0 };
        t[6] = if troop.state == STATE_DUG_IN || troop.dug { 1.0 } else { 0.0 };
        t[7] = within((depths[at] * place.km_at(y)) / 50.0, -1.0, 1.0);
        t[8] = odds(mine, facing);
        t[9] = crowd(mine);
        t[10] = crowd(facing);

        let strike = nearest_of(&weak, place, x, y, 0.0);
        t[11] = strike.map(|(_, km)| km / REACH_MOST_KM).unwrap_or(1.0);
        t[12] = strike.map(|(at, _)| odds(weak[at].mine, weak[at].facing)).unwrap_or(0.0);
        if let Some((found, _)) = strike {
            valid[STRIKE] = !troop.pocket;
            goal[STRIKE] = format!("strike {found}");
        }
        let mass = nearest_of(&masses, place, x, y, 0.0);
        t[13] = mass.map(|(_, km)| km / REACH_MOST_KM).unwrap_or(1.0);
        t[14] = mass.map(|(at, _)| crowd(masses[at].facing)).unwrap_or(0.0);
        if let Some((found, _)) = mass {
            let [bx, by] = sideways[found];
            let sign = if (x - masses[found].x) * bx + (y - masses[found].y) * by >= 0.0 { "1" } else { "-1" };
            valid[GO_ROUND] = !troop.pocket;
            goal[GO_ROUND] = format!("round {found} {sign}");
        }
        let city = nearest_of(&to_take, place, x, y, 0.0);
        let city_of = |spots: &[Spot], at: usize| spots[at].city.clone().unwrap();
        t[15] = city.map(|(_, km)| km / REACH_MOST_KM).unwrap_or(1.0);
        t[16] = city.map(|(at, _)| city_worth(&city_of(&to_take, at).city) / 3.0).unwrap_or(0.0);
        t[17] = city.map(|(at, _)| city_of(&to_take, at).held).unwrap_or(0.0);
        if let Some((found, _)) = city {
            valid[TAKE_CITY] = true;
            goal[TAKE_CITY] = format!("city {}", city_of(&to_take, found).at);
        }
        let capital = nearest_of(&capitals, place, x, y, 0.0);
        t[18] = capital.map(|(_, km)| km / REACH_MOST_KM).unwrap_or(1.0);
        t[19] = capital.map(|(at, _)| city_of(&capitals, at).held).unwrap_or(0.0);
        if let Some((found, _)) = capital {
            valid[TAKE_CAPITAL] = true;
            goal[TAKE_CAPITAL] = format!("city {}", city_of(&capitals, found).at);
        }
        let guard = nearest_of(&guarded, place, x, y, 0.0);
        t[20] = guard.map(|(_, km)| km / REACH_MOST_KM).unwrap_or(1.0);
        t[21] = guard.map(|(at, _)| city_of(&guarded, at).danger).unwrap_or(0.0);
        t[22] = guard.map(|(at, _)| city_worth(&city_of(&guarded, at).city) / 3.0).unwrap_or(0.0);
        if let Some((found, km)) = guard {
            if km >= HERE_KM {
                valid[GUARD] = true;
                goal[GUARD] = format!("guard {}", city_of(&guarded, found).at);
            }
        }
        let shore = nearest_of(&shaky, place, x, y, HERE_KM);
        t[23] = shore.map(|(_, km)| km / REACH_MOST_KM).unwrap_or(1.0);
        t[24] = shore.map(|(at, _)| shaky[at].there).unwrap_or(0.0);
        if let Some((found, _)) = shore {
            valid[SHORE_UP] = true;
            goal[SHORE_UP] = format!("shore {found}");
        }
        t[25] = rank[at];
        t[26] = if troop.order.truthy() && !troop.order.get("done").truthy() && matches!(troop.order.get("kind"), Val::Str(kind) if kind == "way" || kind == "assault") { 1.0 } else { 0.0 };
        t[27] = if kept.iter().any(|city| km_between(place, city.x, city.y, x, y) < 2.0 * HERE_KM) { 1.0 } else { 0.0 };
        t[28] = within(js::or_zero(troop.fatigue), 0.0, 1.0);
        let wall = nearest_of(&walls, place, x, y, 0.0);
        t[29] = wall.map(|(_, km)| km / REACH_MOST_KM).unwrap_or(1.0);
        t[30] = wall.map(|(at, _)| walls[at].level / 10.0).unwrap_or(0.0);
        if let Some((found, _)) = wall {
            if !troop.pocket {
                valid[BREACH] = true;
                goal[BREACH] = format!("breach {found}");
            }
        }
        t[31] = within(battle.sky.as_ref().map(|sky| sky.effects.pace).unwrap_or(1.0) * troop.climate.as_ref().map(|climate| climate.pace()).unwrap_or(1.0), 0.0, 1.5);
        t[32] = within(sky, -1.0, 1.0);
        t[33] = mustering;
        valid[REST] = !troop.pocket;
        goal[REST] = "rest".to_string();
        view.rows.push(Row { index: point.index, t, valid, goal });
    }
    view
}
