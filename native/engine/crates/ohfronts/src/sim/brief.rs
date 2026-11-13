use super::air::sky_held;
use super::attrition::battle_attrition;
use super::battle::Battle;
use super::constants::{BRIEF_TEXT_MAX, FATIGUE_EXHAUSTED, RESERVES_AMPLE_PER_TROOP, SCENARIO_MARK};
use super::ground::measure;

pub const HOME_NEAR_KM: f64 = 60.0;
use super::field::trace_contour;
use super::js::{self, Obj, Val};
use super::line::measure_line;
use super::muster::levy_pending;
use super::sectors::{describe_point, in_sector, read_sectors, Cut, Sector, Sectors};
use super::troops::{is_live, Troop};
use crate::jsmath;
use std::cmp::Ordering;

fn unique(names: &[Val]) -> Val {
    let mut out: Vec<Val> = Vec::new();
    for name in names {
        if !out.iter().any(|known| js::same_value_zero(known, name)) {
            out.push(name.clone());
        }
    }
    Val::Arr(out)
}

fn is_kind(order: &Val, kind: &str) -> bool {
    matches!(order.get("kind"), Val::Str(text) if text == kind)
}

fn doing_of(troop: &Troop) -> Val {
    let order = if troop.order.truthy() && !troop.order.get("done").truthy() { Some(&troop.order) } else { None };
    if troop.pocket {
        return Val::str("cut-off");
    }
    if troop.dug {
        return Val::str("dug-in");
    }
    let order = match order {
        Some(order) => order,
        None => return Val::str("holding"),
    };
    if is_kind(order, "way") {
        return if matches!(order.get("word"), Val::Str(word) if word == "path") {
            Val::str("on-route")
        } else if order.get("own").truthy() {
            Val::str("advancing")
        } else {
            order.get("word").clone()
        };
    }
    for (kind, word) in [("reduce", "closing"), ("assault", "assaulting"), ("fallback", "falling-back"), ("withdraw", "withdrawing"), ("breakout", "breaking-out"), ("pursue", "pursuing")] {
        if is_kind(order, kind) {
            return Val::str(word);
        }
    }
    Val::str("holding")
}

fn frozen_names(battle: &Battle) -> Vec<String> {
    let arena = &battle.arena;
    let iced = match &arena.iced {
        Some(iced) => iced,
        None => return Vec::new(),
    };
    let mut names: Vec<String> = Vec::new();
    let mut cell = 0;
    while cell < arena.size && names.len() < 4 {
        if iced.get(cell).copied() == Some(1) {
            let name = arena.names.get(arena.region[cell] as usize).cloned().unwrap_or_default();
            if !names.contains(&name) {
                names.push(name);
            }
        }
        cell += 1;
    }
    names.into_iter().filter(|name| !name.is_empty()).collect()
}

fn n(value: f64) -> Val {
    Val::Num(value)
}

pub const ALONG_MOST: usize = 10;
pub const HELD_REGIONS_MOST: usize = 12;
pub const HELD_CITIES_MOST: usize = 8;

fn named_region(arena: &super::arena::Arena, region: usize) -> bool {
    region > 0 && region < arena.names.len() && !arena.names[region].is_empty() && arena.names[region] != arena.ids[region]
}

fn by_or(by: f64, then: f64) -> f64 {
    if by != 0.0 && !by.is_nan() {
        by
    } else {
        then
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Held {
    pub cities: Vec<(String, bool)>,
    pub regions: Vec<String>,
    pub more: usize,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Geography {
    pub along: Vec<String>,
    pub holds: [Held; 2],
}

pub fn line_geography(battle: &Battle, sectors: &Sectors) -> Geography {
    let field = battle.field.as_ref().unwrap();
    let arena = &battle.arena;
    let home = battle.home_side.as_deref();
    let (cols, size) = (field.cols, field.size);
    let axis = sectors.names.get(1).and_then(|high| sectors.cut(high));
    let count = arena.names.len();
    let mut line_cells = vec![0.0f64; count];
    let mut line_along = vec![0.0f64; count];
    let mark = |cell: usize, line_cells: &mut Vec<f64>, line_along: &mut Vec<f64>| {
        let region = arena.region[cell] as usize;
        if !named_region(arena, region) {
            return;
        }
        let col = cell % cols;
        line_cells[region] += 1.0;
        line_along[region] += match &axis {
            Some(axis) => (col as f64 + 0.5) * axis.x + (((cell - col) / cols) as f64 + 0.5) * axis.y,
            None => 0.0,
        };
    };
    for cell in 0..size {
        let side = field.holders[cell];
        if side > 1 || field.play[cell] == 0 {
            continue;
        }
        let col = cell % cols;
        let right = if col + 1 < cols { Some(cell + 1) } else { None };
        let down = if cell + cols < size { Some(cell + cols) } else { None };
        for next in [right, down] {
            let Some(next) = next else { continue };
            if field.play[next] == 0 {
                continue;
            }
            let other = field.holders[next];
            if other > 1 || other == side {
                continue;
            }
            mark(cell, &mut line_cells, &mut line_along);
            mark(next, &mut line_cells, &mut line_along);
        }
    }
    let mut touched: Vec<usize> = (1..count).filter(|&region| line_cells[region] > 0.0).collect();
    js::stable_sort_by(&mut touched, |&a, &b| by_or(line_cells[b] - line_cells[a], a as f64 - b as f64));
    touched.truncate(ALONG_MOST);
    js::stable_sort_by(&mut touched, |&a, &b| by_or(line_along[b] / line_cells[b] - line_along[a] / line_cells[a], a as f64 - b as f64));
    let along: Vec<String> = touched.iter().map(|&region| arena.names[region].clone()).collect();
    let mut holds: [Held; 2] = [Held::default(), Held::default()];
    if let Some(home) = home {
        let mut in_play = vec![0.0f64; count];
        let mut by_other = vec![0.0f64; count];
        for cell in 0..size {
            if field.play[cell] == 0 {
                continue;
            }
            let region = arena.region[cell] as usize;
            let owner = home.get(region).copied().unwrap_or(-1);
            if owner != 0 && owner != 1 {
                continue;
            }
            in_play[region] += 1.0;
            if field.holders[cell] as i32 == 1 - owner as i32 {
                by_other[region] += 1.0;
            }
        }
        for side in 0..2usize {
            let other = 1 - side as i8;
            let mut taken: Vec<usize> = (1..count)
                .filter(|&region| home.get(region).copied() == Some(other) && in_play[region] > 0.0 && by_other[region] * 2.0 >= in_play[region] && named_region(arena, region))
                .collect();
            js::stable_sort_by(&mut taken, |&a, &b| by_or(by_other[b] - by_other[a], a as f64 - b as f64));
            holds[side].regions = taken.iter().take(HELD_REGIONS_MOST).map(|&region| arena.names[region].clone()).collect();
            holds[side].more = taken.len().saturating_sub(HELD_REGIONS_MOST);
            let mut cities: Vec<&super::arena::City> = arena
                .cities
                .iter()
                .filter(|city| city.cell >= 0.0 && city.cell < size as f64 && field.holders[city.cell as usize] as usize == side && home.get(arena.region[city.cell as usize] as usize).copied() == Some(other))
                .collect();
            js::stable_sort_by(&mut cities, |a, b| {
                let capital = (if b.capital { 1.0 } else { 0.0 }) - (if a.capital { 1.0 } else { 0.0 });
                let name = match js::compare_units(&a.name, &b.name) {
                    Ordering::Less => -1.0,
                    Ordering::Greater => 1.0,
                    Ordering::Equal => 0.0,
                };
                by_or(capital, by_or(b.population - a.population, name))
            });
            holds[side].cities = cities.iter().take(HELD_CITIES_MOST).map(|city| (city.name.clone(), city.capital)).collect();
        }
    }
    Geography { along, holds }
}

pub fn geography_val(geography: &Geography) -> (Val, Val) {
    let along = Val::Arr(geography.along.iter().map(|name| Val::str(name)).collect());
    let holds = Val::Arr(
        geography
            .holds
            .iter()
            .map(|held| {
                let cities = Val::Arr(
                    held.cities
                        .iter()
                        .map(|(name, capital)| {
                            let mut city = Obj::new();
                            city.set("name", Val::str(name));
                            if *capital {
                                city.set("capital", Val::Bool(true));
                            }
                            Val::Obj(city)
                        })
                        .collect(),
                );
                Val::obj([("cities", cities), ("regions", Val::Arr(held.regions.iter().map(|name| Val::str(name)).collect())), ("more", n(held.more as f64))])
            })
            .collect(),
    );
    (along, holds)
}

pub fn build_brief(battle: &mut Battle, since: &Val, alive: &dyn Fn(&str) -> bool) -> Val {
    let contour = trace_contour(battle.field.as_mut().unwrap());
    let home_near = if battle.home {
        measure(battle.field.as_ref().unwrap(), &mut battle.to_side);
        let field = battle.field.as_ref().unwrap();
        let to_other = &battle.to_side.as_ref().unwrap().sides[1];
        let mut count = 0.0;
        for troop in &battle.troops[0] {
            if !is_live(troop) {
                continue;
            }
            let cell = troop.y.floor() * field.cols as f64 + troop.x.floor();
            if cell >= 0.0 && cell < field.size as f64 && (to_other[cell as usize] as f64 / 3.0) * battle.frame.km <= HOME_NEAR_KM {
                count += 1.0;
            }
        }
        count
    } else {
        0.0
    };
    let battle = &*battle;
    let field = battle.field.as_ref().unwrap();
    let place = &battle.place;
    let km_at = |y: f64| place.km_at(y);
    let line = measure_line(field, &contour);
    let measured = &line.measured;
    let sectors = read_sectors(&contour, measured.count);
    let geography = line_geography(battle, &sectors);
    let mut rows: Vec<Val> = Vec::new();
    for name in &sectors.names {
        if name == "all" {
            continue;
        }
        let cut = sectors.cut(name).unwrap_or(Cut { x: f64::NAN, y: f64::NAN, from: f64::NAN, to: f64::NAN });
        let sector = Sector::Cut { word: name.clone(), cut };
        let mut first: i64 = -1;
        let mut last: i64 = -1;
        let mut length_km = 0.0;
        for strand in &contour.strands {
            for step in 0..strand.count {
                let vertex = strand.first + step;
                if !in_sector(&sector, contour.x[vertex], contour.y[vertex], km_at) {
                    continue;
                }
                if first < 0 {
                    first = vertex as i64;
                }
                if last >= 0 && measured.strand[last as usize] == measured.strand[vertex] && vertex as i64 == last + 1 {
                    length_km += measured.km[vertex] - measured.km[last as usize];
                }
                last = vertex as i64;
            }
        }
        if first < 0 {
            continue;
        }
        let counts: Vec<Val> = (0..2).map(|side| n(battle.troops[side].iter().fold(0.0, |count, troop| count + if is_live(troop) && in_sector(&sector, troop.x, troop.y, km_at) { 1.0 } else { 0.0 }))).collect();
        let mut gained = 0.0;
        let start = battle.start_holders.as_deref().unwrap_or(&[]);
        for index in 0..field.size {
            let now = field.holders[index];
            let then = start.get(index).copied();
            if Some(now) == then || now > 1 || then.map(|then| then > 1).unwrap_or(true) {
                continue;
            }
            let col = index % field.cols;
            let row = index / field.cols;
            if in_sector(&sector, col as f64 + 0.5, row as f64 + 0.5, km_at) {
                gained += (if now == 0 { 1.0 } else { -1.0 }) * place.row_km[row] * place.row_km[row];
            }
        }
        let (first, last) = (first as usize, last as usize);
        let mut row = Obj::new();
        row.set("name", Val::str(name));
        row.set("from", Val::Str(describe_point(&battle.arena, contour.x[first], contour.y[first])));
        row.set("to", Val::Str(describe_point(&battle.arena, contour.x[last], contour.y[last])));
        row.set("n", Val::Arr(counts));
        row.set("moved", n(if length_km > 0.0 { jsmath::round(gained / length_km) } else { 0.0 }));
        rows.push(Val::Obj(row));
    }

    let strength: Vec<Val> = (0..2)
        .map(|side| {
            let live: Vec<&Troop> = battle.troops[side].iter().filter(|troop| is_live(troop)).collect();
            let pool = battle.pool[side];
            let members: Vec<Val> = battle.sides[side]
                .iter()
                .enumerate()
                .map(|(owner, name)| (name, live.iter().fold(0.0, |count, troop| count + if troop.owner == owner as f64 { 1.0 } else { 0.0 })))
                .filter(|(_, count)| *count > 0.0)
                .map(|(name, count)| Val::obj([("name", Val::str(name)), ("n", n(count))]))
                .collect();
            let tired = live.iter().fold(0.0, |count, troop| count + if troop.fatigue >= FATIGUE_EXHAUSTED { 1.0 } else { 0.0 });
            let mustering = levy_pending(&battle.levy[side]);
            let count = live.len() as f64;
            let mut out = Obj::new();
            out.set("n", n(count));
            if mustering > 0.0 {
                out.set("mustering", n(mustering));
            }
            out.set("pct", n(if count > 0.0 { jsmath::round(live.iter().fold(0.0, |sum, troop| sum + troop.strength) / count) } else { 0.0 }));
            if tired > 0.0 {
                out.set("tired", n(tired));
            }
            out.set("reserves", Val::str(if pool >= RESERVES_AMPLE_PER_TROOP * jsmath::max(1.0, count) { "ample" } else if pool >= 1.0 { "thin" } else { "none" }));
            if members.len() > 1 {
                out.set("members", Val::Arr(members));
            }
            Val::Obj(out)
        })
        .collect();

    let mut manned: Vec<i32> = Vec::new();
    if let Some(pocket_of) = &battle.pocket_of {
        for side in 0..2 {
            for troop in &battle.troops[side] {
                let inside = troop.x >= 0.0 && troop.y >= 0.0 && troop.x < field.cols as f64 && troop.y < field.rows as f64;
                let pocket = if is_live(troop) && inside { pocket_of[side][(troop.y.floor() * field.cols as f64 + troop.x.floor()) as usize] } else { -1 };
                if pocket >= 0 && !manned.contains(&pocket) {
                    manned.push(pocket);
                }
            }
        }
    }
    let mut pockets: Vec<Val> = Vec::new();
    for (index, pocket) in battle.pockets.iter().enumerate() {
        if !manned.contains(&(index as i32)) {
            continue;
        }
        let at = if !pocket.siege.is_empty() { pocket.siege.clone() } else { describe_point(&battle.arena, (pocket.cell % field.cols as f64) + 0.5, (pocket.cell / field.cols as f64).floor() + 0.5) };
        if at.is_empty() {
            continue;
        }
        let mut out = Obj::new();
        out.set("s", n(pocket.s as f64));
        out.set("at", Val::Str(at));
        out.set("days", n(pocket.days));
        if !pocket.siege.is_empty() {
            out.set("siege", Val::Bool(true));
        }
        pockets.push(Val::Obj(out));
    }

    struct Body {
        n: f64,
        strength: f64,
        x: f64,
        y: f64,
        cut: f64,
        dug: f64,
        at: Vec<(Val, f64)>,
    }
    let commands: Vec<Val> = (0..2)
        .map(|side| {
            let mut bodies: Vec<Option<Body>> = Vec::new();
            for troop in &battle.troops[side] {
                if !is_live(troop) || !(troop.command >= 0.0) || troop.command.fract() != 0.0 {
                    continue;
                }
                let at = troop.command as usize;
                if bodies.len() <= at {
                    bodies.resize_with(at + 1, || None);
                }
                let body = bodies[at].get_or_insert_with(|| Body { n: 0.0, strength: 0.0, x: 0.0, y: 0.0, cut: 0.0, dug: 0.0, at: Vec::new() });
                body.n += 1.0;
                body.strength += troop.strength;
                body.x += troop.x;
                body.y += troop.y;
                if troop.pocket {
                    body.cut += 1.0;
                }
                if troop.dug {
                    body.dug += 1.0;
                }
                let doing = doing_of(troop);
                match body.at.iter_mut().find(|(what, _)| js::same_value_zero(what, &doing)) {
                    Some(entry) => entry.1 += 1.0,
                    None => body.at.push((doing, 1.0)),
                }
            }
            Val::Arr(
                bodies
                    .iter()
                    .map(|body| match body {
                        None => Val::obj([("n", n(0.0))]),
                        Some(body) => {
                            let mut doing = Val::str("holding");
                            let mut most = 0.0;
                            for (what, count) in &body.at {
                                if *count > most {
                                    most = *count;
                                    doing = what.clone();
                                }
                            }
                            Val::obj([
                                ("n", n(body.n)),
                                ("pct", n(jsmath::round(body.strength / body.n))),
                                ("at", Val::Str(describe_point(&battle.arena, body.x / body.n, body.y / body.n))),
                                ("doing", doing),
                                ("cut", n(body.cut)),
                                ("dug", n(body.dug)),
                            ])
                        }
                    })
                    .collect(),
            )
        })
        .collect();

    let mut out = Obj::new();
    out.set("km", n(jsmath::round(measured.total)));
    out.set("axis", Val::Str(sectors.axis.clone()));
    out.set("sectors", Val::Arr(rows));
    let (along, holds) = geography_val(&geography);
    out.set("along", along);
    out.set("holds", holds);
    out.set("commands", Val::Arr(commands));
    out.set("strength", Val::Arr(strength));
    if battle.home && home_near > 0.0 {
        out.set("near", n(home_near));
    }
    out.set("taken",Val::Arr(vec![unique(&battle.taken[0]), unique(&battle.taken[1])]));
    out.set("cities", Val::Arr(vec![unique(&battle.cities_taken[0]), unique(&battle.cities_taken[1])]));
    out.set("pockets", Val::Arr(pockets));
    out.set("since", since.clone());
    if let Some(held) = sky_held(battle, alive) {
        let mut air = Obj::new();
        air.set("holds", n(held.holds as f64));
        air.set("wings", Val::nums(&[held.wings[0] as f64, held.wings[1] as f64]));
        air.set("superiority", n(held.superiority));
        air.set("missions", Val::Arr(vec![Val::str(held.missions[0]), Val::str(held.missions[1])]));
        if held.strike {
            air.set("strike", Val::Bool(true));
        }
        out.set("air", Val::Obj(air));
    }
    let frozen = frozen_names(battle);
    if !frozen.is_empty() {
        out.set("frozen", Val::Arr(frozen.iter().map(|name| Val::str(name)).collect()));
    }
    if let Some(lost) = battle_attrition(battle) {
        out.set("attrition", Val::nums(&lost));
    }
    if let (Some(sky), Some(skies)) = (&battle.sky, &battle.skies) {
        let mut days = Obj::new();
        for (state, count) in &skies.entries {
            days.set(state, n(*count));
        }
        out.set("weather", Val::obj([("season", sky.season.clone()), ("now", Val::str(sky.state)), ("days", Val::Obj(days))]));
    }
    Val::Obj(out)
}

fn item(value: &Val, at: usize) -> Val {
    match value {
        Val::Arr(list) => list.get(at).cloned().unwrap_or(Val::Undef),
        Val::Str(text) => js::units(text).get(at).map(|&unit| Val::Str(String::from_utf16_lossy(&[unit]))).unwrap_or(Val::Undef),
        Val::Typed(typed) => if at < typed.len() { Val::Num(typed.at(at)) } else { Val::Undef },
        other => other.get(&at.to_string()).clone(),
    }
}

fn or_empty(value: Val) -> Val {
    if value.is_nullish() {
        Val::str("")
    } else {
        value
    }
}

fn text(value: &Val) -> String {
    js::to_string(value)
}

fn join(list: &[Val], separator: &str) -> String {
    list.iter().map(|value| if value.is_nullish() { String::new() } else { js::to_string(value) }).collect::<Vec<_>>().join(separator)
}

fn above_zero(value: &Val) -> bool {
    js::to_number(value) > 0.0
}

fn length_of(value: &Val) -> f64 {
    match value {
        Val::Arr(list) => list.len() as f64,
        Val::Str(text) => js::utf16_len(text) as f64,
        Val::Typed(typed) => typed.len() as f64,
        _ => f64::NAN,
    }
}

fn names_list(names: &[Val], kind: &str, most: usize) -> String {
    let mut shown: Vec<String> = names.iter().take(most).map(|name| format!("{kind}: {}", text(name))).collect();
    if names.len() > most {
        shown.push(format!("{} more", js::number_to_string((names.len() - most) as f64)));
    }
    shown.join(", ")
}

fn orders_of(record: &Val, side: usize) -> String {
    let mine: Vec<(usize, &Val)> = record.get("orders").array_or_empty().iter().enumerate().filter(|(_, order)| matches!(order.get("s"), Val::Num(s) if *s == side as f64)).collect();
    if mine.is_empty() {
        return "all hold".to_string();
    }
    let under = item(record.get("brief").get("carry").get("under"), side);
    let serving = |index: usize| -> f64 { under.array_or_empty().iter().filter(|serves| matches!(serves, Val::Num(at) if *at == index as f64)).count() as f64 };
    let line: Vec<&Val> = mine.iter().filter(|(_, order)| !order.get("chosen").truthy()).map(|(_, order)| *order).collect();
    let members = item(record.get("sides"), side);
    let lead = js::lower(&text(&or_empty(item(&members, 0))));
    let whose = |order: &Val| -> String {
        if length_of(&members) > 1.0 && order.get("by").truthy() && js::lower(&text(order.get("by"))) != lead {
            format!(" ({}'s troops)", text(order.get("by")))
        } else {
            String::new()
        }
    };
    let toward = |order: &Val| -> String {
        if order.get("objective").truthy() {
            format!(" toward {}", text(order.get("objective")))
        } else {
            String::new()
        }
    };
    let mut parts: Vec<String> = line
        .iter()
        .map(|order| format!("{} {}{}{}{}", text(order.get("sector")), text(order.get("order")), toward(order), whose(order), if matches!(order.get("mark"), Val::Str(mark) if mark == SCENARIO_MARK) { " (the scenario's)" } else { "" }))
        .collect();
    for (index, order) in &mine {
        if !order.get("chosen").truthy() {
            continue;
        }
        let attacks = order.get("attacks");
        let into = match attacks {
            Val::Arr(list) if !list.is_empty() => format!(", into {}, which is not in the war", join(list, " and ")),
            _ => String::new(),
        };
        let what = if order.get("way").truthy() { format!("sent along a route drawn for them{into}") } else { format!("{}{}", text(order.get("order")), toward(order)) };
        parts.push(format!("{} formations {what}", js::number_to_string(serving(*index))));
    }
    let effort = text(&item(record.get("effort"), side));
    parts[0] = format!("{} ({effort})", parts[0]);
    if !line.iter().any(|order| matches!(order.get("sector"), Val::Str(sector) if sector == "all")) {
        parts.push("elsewhere hold".to_string());
    }
    parts.join("; ")
}

#[derive(Clone, Debug, PartialEq)]
pub struct Since {
    pub since: String,
    pub text: String,
    pub moved: bool,
}

pub fn describe_since(record: &Val, most: usize) -> Since {
    let brief = if record.get("brief").is_nullish() { Val::Obj(Obj::new()) } else { record.get("brief").clone() };
    let lead = [or_empty(item(&item(record.get("sides"), 0), 0)), or_empty(item(&item(record.get("sides"), 1), 0))];
    let lead_at = |key: &Val| -> String {
        match js::to_string(key).as_str() {
            "0" => text(&lead[0]),
            "1" => text(&lead[1]),
            _ => "undefined".to_string(),
        }
    };
    let sectors = brief.get("sectors").as_array().cloned().unwrap_or_default();
    let moves: Vec<String> = (0..2)
        .map(|side| {
            let gained: Vec<&Val> = sectors.iter().take(3).filter(|sector| js::to_number(sector.get("moved")).abs() >= 1.0 && (js::to_number(sector.get("moved")) > 0.0) == (side == 0)).collect();
            if gained.is_empty() {
                String::new()
            } else {
                format!("{} advanced {}", text(&lead[side]), gained.iter().map(|sector| format!("{} km in the {}", js::number_to_string(js::to_number(sector.get("moved")).abs()), text(sector.get("name")))).collect::<Vec<_>>().join(", "))
            }
        })
        .filter(|text| !text.is_empty())
        .collect();
    let taken = if brief.get("taken").as_array().is_some() { brief.get("taken").clone() } else { Val::Arr(vec![Val::Arr(Vec::new()), Val::Arr(Vec::new())]) };
    let cities = if brief.get("cities").as_array().is_some() { brief.get("cities").clone() } else { Val::Arr(vec![Val::Arr(Vec::new()), Val::Arr(Vec::new())]) };
    let gains = |side: usize| -> String {
        [names_list(item(&cities, side).array_or_empty(), "city", most), names_list(item(&taken, side).array_or_empty(), "region", most)].into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join(", ")
    };
    let mut parts = vec![if !moves.is_empty() { moves.join("; ") } else { "the line did not move".to_string() }];
    let took = gains(0);
    let lost = gains(1);
    if !took.is_empty() || !lost.is_empty() {
        parts.push(format!("{} took {}", text(&lead[0]), if took.is_empty() { "none" } else { &took }));
        parts.push(format!("lost {}", if lost.is_empty() { "none" } else { &lost }));
    }
    let pockets: Vec<String> = brief
        .get("pockets")
        .array_or_empty()
        .iter()
        .take(2)
        .map(|pocket| {
            let siege = pocket.get("siege").truthy();
            let other = Val::Num(1.0 - js::to_number(pocket.get("s")));
            format!(
                "{}: troops of {} are {} by {} at {}, {} days.",
                if siege { "Besieged" } else { "Surrounded" },
                lead_at(pocket.get("s")),
                if siege { "shut in" } else { "cut off" },
                lead_at(&other),
                text(pocket.get("at")),
                text(pocket.get("days"))
            )
        })
        .collect();
    let since = brief.get("since");
    Since {
        since: if since.is_nullish() { String::new() } else { text(since) },
        text: format!("{}.{}", parts.join("; "), if pockets.is_empty() { String::new() } else { format!(" {}", pockets.join(" ")) }),
        moved: !moves.is_empty() || !took.is_empty() || !lost.is_empty(),
    }
}

pub fn sky_stronger_note(held: &Val, against: &Val) -> &'static str {
    let mine = js::or_zero(js::to_number(held));
    let theirs = js::or_zero(js::to_number(against));
    if mine < theirs {
        ", fewer but stronger"
    } else if mine == theirs {
        ", as many but stronger"
    } else {
        ""
    }
}

fn add(sum: Val, value: &Val) -> Val {
    match (&sum, value) {
        (Val::Str(_), _) | (_, Val::Str(_)) => Val::Str(format!("{}{}", text(&sum), text(value))),
        _ => Val::Num(js::to_number(&sum) + js::to_number(value)),
    }
}

pub fn describe_battlefield(record: &Val, viewer: &Val) -> String {
    describe_battlefield_within(record, viewer, BRIEF_TEXT_MAX)
}

pub fn describe_battlefield_within(record: &Val, viewer: &Val, max: f64) -> String {
    if !record.truthy() || record.get("sides").as_array().is_none() {
        return String::new();
    }
    let brief = if record.get("brief").is_nullish() { Val::Obj(Obj::new()) } else { record.get("brief").clone() };
    let sides = record.get("sides");
    if record.get("home").is_true() {
        let own = match brief.get("strength") {
            Val::Arr(list) => list.first().filter(|entry| !entry.is_nullish()).cloned().unwrap_or(Val::Obj(Obj::new())),
            _ => Val::Obj(Obj::new()),
        };
        let country = text(&or_empty(item(&item(sides, 0), 0)));
        let mut parts = vec![format!("{} formations round its cities", if own.get("n").is_nullish() { "0".to_string() } else { text(own.get("n")) })];
        if js::to_number(own.get("mustering")) > 0.0 {
            parts.push(format!("{} more still mustering", text(own.get("mustering"))));
        }
        if js::to_number(brief.get("near")) > 0.0 {
            parts.push(format!("{} of them within {} km of its borders", text(brief.get("near")), js::number_to_string(HOME_NEAR_KM)));
        }
        let told = format!("- {}: {}'s forces at home, built up in peace: {}. No war is fought here; its orders are given as home: {}.", text(record.get("name")), country, parts.join(", "), country);
        return js::slice_units(&told, 0, if max > 0.0 { max as usize } else { 0 });
    }
    let lead = [or_empty(item(&item(sides, 0), 0)), or_empty(item(&item(sides, 1), 0))];
    let wanted = js::lower(js::trim(&js::collapse_spaces(&if viewer.is_nullish() { String::new() } else { text(viewer) })));
    let viewing: i64 = if wanted.is_empty() {
        -1
    } else {
        sides.array_or_empty().iter().position(|members| members.array_or_empty().iter().any(|member| js::lower(&text(member)) == wanted)).map(|at| at as i64).unwrap_or(-1)
    };
    let status = match record.get("status") {
        Val::Str(status) if status == "frozen" => ", frozen by a ceasefire",
        Val::Str(status) if status == "closed" => ", closed",
        Val::Str(status) if status == "standing" => ", forces built up in peace: no war is fought here",
        _ => "",
    };
    let km = brief.get("km");
    let head = format!(
        "- {}: {} against {}, open since {}{status}, line {} km",
        text(record.get("name")),
        join(item(sides, 0).array_or_empty(), ", "),
        join(item(sides, 1).array_or_empty(), ", "),
        text(record.get("openedDate")),
        if km.is_nullish() { "0".to_string() } else { text(km) }
    );
    let strength = match brief.get("strength") {
        Val::Arr(list) if list.len() == 2 => format!(
            "  Strength: {}",
            list.iter()
                .enumerate()
                .map(|(index, side)| {
                    let members = side.get("members");
                    format!(
                        "{} {} formations ({}%){}{}{}, reserves {}",
                        text(&lead[index]),
                        text(side.get("n")),
                        text(side.get("pct")),
                        if above_zero(side.get("tired")) { format!(", {} of them exhausted", text(side.get("tired"))) } else { String::new() },
                        if above_zero(side.get("mustering")) { format!(", {} more still mustering", text(side.get("mustering"))) } else { String::new() },
                        match members {
                            Val::Arr(list) if list.len() > 1 => format!(" ({})", list.iter().map(|member| format!("{} {}", text(member.get("name")), text(member.get("n")))).collect::<Vec<_>>().join(", ")),
                            _ => String::new(),
                        },
                        text(side.get("reserves"))
                    )
                })
                .collect::<Vec<_>>()
                .join("; ")
        ),
        _ => String::new(),
    };
    let weather_of = brief.get("weather");
    let weather = if weather_of.truthy() && weather_of.is_object() && weather_of.get("days").truthy() {
        let mut days: Vec<(String, Val)> = js::entries(weather_of.get("days")).into_iter().filter(|(_, count)| above_zero(count)).collect();
        js::stable_sort_by(&mut days, |a, b| {
            let by = js::to_number(&b.1) - js::to_number(&a.1);
            if by != 0.0 && !by.is_nan() {
                by
            } else if js::compare_units(&a.0, &b.0) == Ordering::Less {
                -1.0
            } else {
                1.0
            }
        });
        let total = days.iter().fold(Val::Num(0.0), |sum, (_, count)| add(sum, count));
        let spells = days.iter().take(3).enumerate().map(|(at, (state, count))| format!("{state} on {}{}", text(count), if at == 0 { format!(" of {} days", text(&total)) } else { String::new() })).collect::<Vec<_>>().join(", ");
        format!(
            "  Weather: {}{spells}{}",
            if weather_of.get("season").truthy() { format!("{}; ", text(weather_of.get("season"))) } else { String::new() },
            if weather_of.get("now").truthy() { format!("; {} now", text(weather_of.get("now"))) } else { String::new() }
        )
    } else {
        String::new()
    };
    let attrition = match brief.get("attrition") {
        Val::Arr(list) if list.iter().any(above_zero) => format!(
            "  Attrition: {} to the weather and to being cut off this period",
            (0..2).map(|side| format!("{} lost {} formations' worth", text(&lead[side]), { let lost = item(brief.get("attrition"), side); if lost.is_nullish() { "0".to_string() } else { text(&lost) } })).collect::<Vec<_>>().join(", ")
        ),
        _ => String::new(),
    };
    let air_of = brief.get("air");
    let air = match air_of.get("holds") {
        Val::Num(holds) if air_of.truthy() && (*holds == 0.0 || *holds == 1.0) && air_of.get("wings").as_array().is_some() => {
            let holds = *holds as usize;
            format!("  Air: {} holds the sky ({} wings against {}{})", text(&lead[holds]), text(&item(air_of.get("wings"), holds)), text(&item(air_of.get("wings"), 1 - holds)), sky_stronger_note(&item(air_of.get("wings"), holds), &item(air_of.get("wings"), 1 - holds)))
        }
        _ => String::new(),
    };
    let ice = match brief.get("frozen") {
        Val::Arr(list) if !list.is_empty() => format!("  Ice: {} {} frozen hard enough for troops to cross", join(list, ", "), if list.len() == 1 { "is" } else { "are" }),
        _ => String::new(),
    };
    let gone = (0..2)
        .filter(|&side| matches!(item(brief.get("carry").get("away"), side), Val::Bool(true)))
        .map(|side| format!("  {} has withdrawn its troops from here: the ground it holds is unguarded until it orders them back.", text(&lead[side])))
        .collect::<Vec<_>>()
        .join("\n");
    let sectors = brief.get("sectors").as_array().cloned().unwrap_or_default();
    let place: Vec<&Val> = sectors.iter().filter(|sector| sector.get("from").truthy() && sector.get("to").truthy()).collect();
    let line_text = |most: usize| -> String {
        if place.is_empty() || most == 0 {
            return String::new();
        }
        format!(
            "  Line: {}",
            place
                .iter()
                .take(most)
                .map(|sector| format!("{}: {}", text(sector.get("name")), if js::strict_equals(sector.get("from"), sector.get("to")) { text(sector.get("from")) } else { format!("{} to {}", text(sector.get("from")), text(sector.get("to"))) }))
                .collect::<Vec<_>>()
                .join("; ")
        )
    };
    let whose = |side: usize| -> String {
        if length_of(&item(sides, side)) > 1.0 {
            format!("{}'s side", text(&lead[side]))
        } else {
            text(&lead[side])
        }
    };
    let along: Vec<Val> = match brief.get("along") {
        Val::Arr(list) => list.iter().filter(|name| matches!(name, Val::Str(name) if !name.is_empty())).cloned().collect(),
        _ => Vec::new(),
    };
    let axis_text = if brief.get("axis").is_nullish() { String::new() } else { text(brief.get("axis")) };
    let ends: Vec<&str> = axis_text.split('-').collect();
    let runs = if !place.is_empty() && ends.len() == 2 {
        if js::strict_equals(place[0].get("name"), &Val::str(ends[0])) {
            format!(" {} to {}", ends[0], ends[1])
        } else {
            format!(" {} to {}", ends[1], ends[0])
        }
    } else {
        String::new()
    };
    let along_text = |most: usize| -> String {
        if along.is_empty() || most == 0 {
            return String::new();
        }
        format!("  The line runs{runs} through {}", names_list(&along, "region", most))
    };
    let holds = match brief.get("holds") {
        Val::Arr(list) => Some(list.clone()),
        _ => None,
    };
    let held_text = |most: usize| -> String {
        let Some(holds) = &holds else { return String::new() };
        if most == 0 {
            return String::new();
        }
        let parts: Vec<String> = (0..2)
            .map(|side| {
                let held = holds.get(side).filter(|held| !held.is_nullish()).cloned().unwrap_or(Val::Obj(Obj::new()));
                let cities: Vec<String> = held
                    .get("cities")
                    .as_array()
                    .map(|list| list.iter().take(most).map(|city| format!("city: {}{}", text(city.get("name")), if city.get("capital").truthy() { " (a capital)" } else { "" })).collect())
                    .unwrap_or_default();
                let regions: Vec<Val> = held.get("regions").as_array().cloned().unwrap_or_default();
                let more = (regions.len() - regions.len().min(most)) as f64 + js::or_zero(js::to_number(held.get("more")));
                let mut shown = cities;
                shown.extend(regions.iter().take(most).map(|name| format!("region: {}", text(name))));
                if shown.is_empty() {
                    return String::new();
                }
                format!("{} holds {}{} of {}'s land", whose(side), shown.join(", "), if more > 0.0 { format!(" and {} more regions", js::number_to_string(more)) } else { String::new() }, whose(1 - side))
            })
            .filter(|part| !part.is_empty())
            .collect();
        format!("  Occupied: {}", if !parts.is_empty() { format!("{}.", parts.join("; ")) } else { "neither side holds any of the other's land.".to_string() })
    };
    let since_text = |most: usize| -> String {
        let since = brief.get("since");
        format!("  Since {}: {}", if since.is_nullish() { String::new() } else { text(since) }, describe_since(record, most).text)
    };
    let standing: Vec<String> = (0..2).filter(|&side| viewing < 0 || side as i64 == viewing).map(|side| format!("{}: {}.", text(&lead[side]), orders_of(record, side))).collect();
    let orders = format!("  Standing orders: {}", standing.join(" "));
    let words: Vec<Val> = sectors.iter().map(|sector| sector.get("name").clone()).collect();
    let every = ["north", "south", "east", "west", "northeast", "southwest", "southeast", "northwest", "centre"].iter().all(|word| words.iter().any(|name| js::same_value_zero(name, &Val::str(word))));
    let valid = format!("  Sectors: {}", if every { "centre and all eight points of the compass, or a place on the line.".to_string() } else if !words.is_empty() { format!("{}, or a place on the line.", join(&words, ", ")) } else { "all, or a place on the line.".to_string() });
    let mut text_out = String::new();
    for (most_sectors, most_names, most_along, most_held, extras) in [
        (3, 4, 8, 6, true),
        (3, 2, 5, 4, true),
        (3, 1, 3, 2, true),
        (2, 1, 2, 2, true),
        (1, 1, 2, 1, true),
        (3, 2, 5, 4, false),
        (3, 1, 3, 3, false),
        (3, 1, 2, 2, false),
        (2, 1, 2, 2, false),
        (1, 1, 2, 1, false),
        (0, 1, 1, 1, false),
    ] {
        let mut parts = vec![head.clone(), strength.clone()];
        if extras {
            parts.extend([weather.clone(), attrition.clone(), ice.clone(), air.clone()]);
        }
        parts.extend([gone.clone(), line_text(most_sectors), along_text(most_along), held_text(most_held), since_text(most_names), orders.clone(), valid.clone()]);
        text_out = parts.into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join("\n");
        if js::utf16_len(&text_out) as f64 <= max {
            return text_out;
        }
    }
    let cut = js::slice_units(&text_out, 0, (max - 1.0).max(0.0) as usize);
    format!("{}…", cut.trim_end_matches(js::is_js_whitespace))
}

