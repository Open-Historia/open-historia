use super::battle::Battle;
use super::engine::Run;
use super::frame::KM_PER_DEGREE;
use super::game_dates::{add_game_days, compare_game_dates};
use super::ground::cell_at;
use super::js::{self, OrdMap, Val};
use super::world_grid::{km_between, Surface};
use crate::jsmath;
use std::rc::Rc;

pub const WALL_PIECE_KM: f64 = 5.0;
pub const WALL_DAYS: [f64; 11] = [f64::INFINITY, f64::INFINITY, f64::INFINITY, 3.0, 6.0, 10.0, 15.0, 22.0, 32.0, 50.0, f64::INFINITY];
pub const WALL_ODDS: f64 = 2.0;
pub const WALL_DEFENCE_PER_LEVEL: f64 = 0.15;
pub const WALL_ASSAULT_COST: f64 = 1.5;
pub const WALL_SIEGE_WEAR: f64 = 3.0;

fn fold(value: &Val) -> String {
    let text = if value.is_nullish() { String::new() } else { js::to_string(value) };
    js::trim(&js::collapse_spaces(&text)).to_lowercase()
}

fn text_of(value: &Val) -> String {
    if value.is_nullish() {
        String::new()
    } else {
        js::to_string(value)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct WallLine {
    pub id: String,
    pub name: String,
    pub owner: String,
    pub level: f64,
    pub points: Vec<[f64; 2]>,
    pub at: Vec<f64>,
    pub breaches: Vec<[f64; 2]>,
    pub wear: OrdMap<f64, f64>,
    pub building: Val,
    pub changed: bool,
}

fn squeeze_esses(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_run = false;
    for unit in text.chars() {
        if unit == 's' {
            if !in_run {
                out.push(' ');
            }
            in_run = true;
        } else {
            in_run = false;
            out.push(unit);
        }
    }
    out
}

fn finite_point(point: &Val) -> Option<[f64; 2]> {
    match point {
        Val::Arr(list) => match (list.first(), list.get(1)) {
            (Some(Val::Num(x)), Some(Val::Num(y))) if x.is_finite() && y.is_finite() => Some([*x, *y]),
            _ => None,
        },
        _ => None,
    }
}

pub fn read_line(line: &Val, surface: Surface) -> WallLine {
    let points: Vec<[f64; 2]> = line.get("points").as_array().map(|list| list.iter().filter_map(finite_point).collect()).unwrap_or_default();
    let mut at = vec![0.0];
    for index in 1..points.len() {
        at.push(at[index - 1] + km_between(points[index - 1][0], points[index - 1][1], points[index][0], points[index][1], surface));
    }
    let name = js::trim(&squeeze_esses(&text_of(line.get("name")))).to_string();
    let mut wear = OrdMap::new();
    for entry in line.get("wear").array_or_empty() {
        wear.set(js::to_number(&entry.element(0)).floor(), js::to_number(&entry.element(1)));
    }
    WallLine {
        id: text_of(line.get("id")),
        name: js::slice_units(&name, 0, 80),
        owner: text_of(line.get("owner")),
        level: jsmath::max(0.0, jsmath::min(10.0, jsmath::round(js::or_zero(js::to_number(line.get("level")))))),
        points,
        at,
        breaches: line.get("breaches").array_or_empty().iter().map(|stretch| [js::to_number(&stretch.element(0)), js::to_number(&stretch.element(1))]).collect(),
        wear,
        building: if line.get("building").is_nullish() { Val::Null } else { line.get("building").clone() },
        changed: false,
    }
}

pub fn read_lines(run: &Run) -> std::cell::Ref<'_, Vec<WallLine>> {
    if run.lines.borrow().is_none() {
        let map = run.input.get("map");
        let surface = Surface { flat: map.get("flat").is_true(), scale: if map.get("scale").is_undef() { KM_PER_DEGREE } else { map.get("scale").num() } };
        let given: &[Val] = if run.mech.walls() { run.input.get("fortifications").array_or_empty() } else { &[] };
        let lines: Vec<WallLine> = given.iter().map(|line| read_line(line, surface)).filter(|line| line.points.len() >= 2).collect();
        *run.lines.borrow_mut() = Some(lines);
    }
    std::cell::Ref::map(run.lines.borrow(), |lines| lines.as_ref().unwrap())
}

pub fn stands_on(line: &WallLine, date: &str) -> bool {
    if line.level < 3.0 {
        return false;
    }
    if !line.building.truthy() {
        return true;
    }
    let days = jsmath::max(0.0, jsmath::round(js::or_zero(js::to_number(line.building.get("days")))));
    let done = add_game_days(&text_of(line.building.get("since")), days);
    !done.is_empty() && compare_game_dates(&done, date) <= 0.0
}

pub fn broken_at(line: &WallLine, km: f64) -> bool {
    line.breaches.iter().any(|[from, to]| km >= *from && km <= *to)
}

fn owner_side(battle: &Battle, owner: &str) -> i32 {
    let wanted = fold(&Val::str(owner));
    if wanted.is_empty() {
        return -1;
    }
    for side in 0..2 {
        if battle.sides[side].iter().enumerate().any(|(at, member)| !battle.gone[side].contains(&at) && fold(&Val::str(member)) == wanted) {
            return side as i32;
        }
    }
    -1
}

#[derive(Clone, Debug, PartialEq)]
pub struct Walls {
    pub cell_line: Vec<i16>,
    pub cell_km: Vec<f32>,
    pub sides: Vec<i32>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WallPiece {
    pub line: usize,
    pub piece: f64,
}

pub fn sides_key(battle: &Battle) -> String {
    (0..2).map(|side| battle.sides[side].iter().enumerate().filter(|(at, _)| !battle.gone[side].contains(at)).map(|(_, member)| member.as_str()).collect::<Vec<_>>().join("|")).collect::<Vec<_>>().join("/")
}

pub fn walls_of(run: &Run, battle: &mut Battle) -> Option<Rc<Walls>> {
    let lines = read_lines(run);
    let key = sides_key(battle);
    if battle.walls_for && battle.wall_sides == key {
        return battle.walls.clone();
    }
    battle.walls_for = true;
    battle.wall_sides = key;
    battle.walls = None;
    if lines.is_empty() {
        return None;
    }
    let sides: Vec<i32> = lines.iter().map(|line| owner_side(battle, &line.owner)).collect();
    if !sides.iter().any(|&side| side >= 0) {
        return None;
    }
    let field = battle.field.as_ref().expect("a battle with a field");
    let place = &battle.place;
    let mut cell_line = vec![0i16; field.size];
    let mut cell_km = vec![0f32; field.size];
    let mut drawn = 0;
    for (index, line) in lines.iter().enumerate() {
        if sides[index] < 0 {
            continue;
        }
        for leg in 1..line.points.len() {
            let [ax, ay] = place.to_cell(line.points[leg - 1][0], line.points[leg - 1][1]);
            let [bx, by] = place.to_cell(line.points[leg][0], line.points[leg][1]);
            let cells = ((bx - ax) * (bx - ax) + (by - ay) * (by - ay)).sqrt();
            let steps = jsmath::max(1.0, (cells * 4.0).ceil());
            let mut step = 0.0;
            while step <= steps {
                let part = step / steps;
                step += 1.0;
                let cell = cell_at(field, ax + (bx - ax) * part, ay + (by - ay) * part);
                if cell < 0 || field.play[cell as usize] == 0 {
                    continue;
                }
                cell_line[cell as usize] = (index + 1) as i16;
                cell_km[cell as usize] = (line.at[leg - 1] + (line.at[leg] - line.at[leg - 1]) * part) as f32;
                drawn += 1;
            }
        }
    }
    if drawn > 0 {
        battle.walls = Some(Rc::new(Walls { cell_line, cell_km, sides }));
    }
    battle.walls.clone()
}

fn stands_against(lines: &[WallLine], walls: Option<&Walls>, cell: usize, side: usize, date: &str) -> Option<WallPiece> {
    let walls = walls?;
    let at = walls.cell_line[cell];
    if at == 0 {
        return None;
    }
    let index = at as usize - 1;
    let line = &lines[index];
    if walls.sides[index] != 1 - side as i32 || !stands_on(line, date) || broken_at(line, walls.cell_km[cell] as f64) {
        return None;
    }
    Some(WallPiece { line: index, piece: (walls.cell_km[cell] as f64 / WALL_PIECE_KM).floor() })
}

pub fn raise_walls(run: &Run, battle: &mut Battle, date: &str) {
    let walls = walls_of(run, battle);
    battle.wall_mask = [None, None];
    battle.wall_date = Some(date.to_string());
    battle.wall_run = true;
    let walls = match walls {
        Some(walls) => walls,
        None => {
            for side in 0..2 {
                for troop in battle.troops[side].iter_mut() {
                    troop.walled = Some(0.0);
                }
            }
            return;
        }
    };
    let lines = read_lines(run);
    let field = battle.field.as_ref().unwrap();
    for cell in 0..field.size {
        if walls.cell_line[cell] == 0 {
            continue;
        }
        for side in 0..2 {
            if stands_against(&lines, battle.walls.as_deref(), cell, side, date).is_none() {
                continue;
            }
            battle.wall_mask[side].get_or_insert_with(|| vec![0u8; field.size])[cell] = 1;
        }
    }
    for side in 0..2 {
        for troop in battle.troops[side].iter_mut() {
            let mut level = 0.0;
            if troop.strength > 0.0 {
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        let cell = cell_at(field, troop.x + dx as f64, troop.y + dy as f64);
                        let at = if cell >= 0 { walls.cell_line[cell as usize] } else { 0 };
                        if at == 0 || walls.sides[at as usize - 1] != side as i32 {
                            continue;
                        }
                        let line = &lines[at as usize - 1];
                        if stands_on(line, date) && !broken_at(line, walls.cell_km[cell as usize] as f64) && line.level > level {
                            level = line.level;
                        }
                    }
                }
            }
            troop.walled = Some(level);
        }
    }
}

pub fn wall_ahead(run: &Run, battle: &Battle, side: usize, x: f64, y: f64) -> Option<WallPiece> {
    if battle.walls.is_none() || !battle.wall_run {
        return None;
    }
    let cell = cell_at(battle.field.as_ref().unwrap(), x, y);
    if cell < 0 {
        return None;
    }
    let lines = run.lines.borrow();
    let date = battle.wall_date.clone().unwrap_or_default();
    stands_against(lines.as_deref().unwrap_or(&[]), battle.walls.as_deref(), cell as usize, side, &date)
}

pub fn wear_wall(run: &Run, battle: &mut Battle, piece: WallPiece, odds: f64, siege: bool, share: f64) -> bool {
    if !battle.wall_run {
        return false;
    }
    let mut lines = run.lines.borrow_mut();
    let line = match lines.as_mut().and_then(|lines| lines.get_mut(piece.line)) {
        Some(line) => line,
        None => return false,
    };
    let days = if line.level >= 0.0 && line.level.fract() == 0.0 { WALL_DAYS.get(line.level as usize).copied().unwrap_or(f64::NAN) } else { f64::NAN };
    if !(days < f64::INFINITY) {
        return false;
    }
    let worn = line.wear.get(&piece.piece).copied().unwrap_or(0.0) + (share * (if odds >= WALL_ODDS { 1.0 } else { odds / WALL_ODDS }) * (if siege { WALL_SIEGE_WEAR } else { 1.0 })) / days;
    line.changed = true;
    if worn < 1.0 {
        line.wear.set(piece.piece, worn);
        return false;
    }
    line.wear.remove(&piece.piece);
    let from = piece.piece * WALL_PIECE_KM;
    line.breaches.push([from, from + WALL_PIECE_KM]);
    js::stable_sort_by(&mut line.breaches, |a, b| a[0] - b[0]);
    let mut merged: Vec<[f64; 2]> = Vec::new();
    for stretch in &line.breaches {
        match merged.last_mut() {
            Some(last) if stretch[0] <= last[1] => last[1] = if last[1] > stretch[1] { last[1] } else { stretch[1] },
            _ => merged.push(*stretch),
        }
    }
    line.breaches = merged;
    let owner = battle.walls.as_ref().and_then(|walls| walls.sides.get(piece.line).copied());
    let at = if line.name.is_empty() { "a fortified line".to_string() } else { format!("wall: {}", line.name) };
    let date = battle.wall_date.clone().unwrap_or_default();
    if let Some(owner @ (0 | 1)) = owner {
        let told = battle.log.iter().any(|entry| matches!(entry.get("k"), Val::Str(k) if k == "breached") && matches!(entry.get("d"), Val::Str(d) if *d == date) && matches!(entry.get("at"), Val::Str(a) if *a == at));
        if !told {
            battle.log.push(Val::obj([("d", Val::Str(date)), ("k", Val::str("breached")), ("s", Val::Num((1 - owner) as f64)), ("at", Val::Str(at))]));
        }
    }
    true
}

pub fn kept_with(battle: &Battle) -> [Option<Vec<u8>>; 2] {
    [0, 1].map(|side| {
        let siege = battle.siege_kept[side].as_ref();
        let wall = battle.wall_mask[side].as_ref();
        match (wall, siege) {
            (None, siege) => siege.cloned(),
            (Some(wall), None) => Some(wall.clone()),
            (Some(wall), Some(siege)) => {
                let mut both = siege.clone();
                for cell in 0..wall.len() {
                    if wall[cell] == 1 {
                        both[cell] = 1;
                    }
                }
                Some(both)
            }
        }
    })
}

#[derive(Clone, Debug, PartialEq)]
pub struct LineChange {
    pub id: String,
    pub breaches: Vec<[f64; 2]>,
    pub wear: Vec<[f64; 2]>,
}

pub fn lines_changed(run: &Run) -> Vec<LineChange> {
    let lines = run.lines.borrow();
    lines
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|line| line.changed)
        .map(|line| {
            let mut wear: Vec<[f64; 2]> = line.wear.entries.iter().filter(|(_, worn)| *worn > 0.0).map(|(piece, worn)| [*piece, *worn]).collect();
            js::stable_sort_by(&mut wear, |a, b| a[0] - b[0]);
            LineChange {
                id: line.id.clone(),
                breaches: line.breaches.iter().map(|[from, to]| [jsmath::round(from * 100.0) / 100.0, jsmath::round(to * 100.0) / 100.0]).collect(),
                wear: wear.iter().map(|[piece, worn]| [*piece, jsmath::round(worn * 1000.0) / 1000.0]).collect(),
            }
        })
        .collect()
}
