use super::arena::arena_for;
use super::battle::{holder_of, member_index, paint_ground, read_region, read_regions, side_of_name, Battle};
use super::closing::find_prey;
use super::combat::{close_day, step_forward};
use super::constants::{CAPTOR_WITHIN_KM, FLIP_AT, GROW_KM, GROW_WITHIN_CELLS, MAX_CELLS, MAX_GRID_SPAN, MIN_DAYS_BETWEEN_FLIPS, OBJECTIVE_GROWS_MOST, PATCH_MAX_KM2, REACH_KM, TRAIT_DRIVE, WHOLE_AT};
use super::dawn::dusk;
use super::engine::Run;
use super::field::{count_holders, redistance, resample_field, take_cells, trace_contour, Claims, Field, Painter};
use super::frame::{create_frame, frame_bounds, Bounds, Frame, Projector, KM_PER_DEGREE};
use super::ground::measure;
use super::js::{self, Val};
use super::line::{measure_line, Line};
use super::movement::move_day;
use super::orders::{age_orders, read_orders};
use super::replay::{create_replay_recorder, Ground, TrackIn};
use super::sectors::{read_sectors, Sectors};
use super::supply::{mark_pockets, mark_supply, refresh_supply, settle_pockets};
use super::troops::{draw_traits, is_live, live_count, stands};
use crate::frame::{lat_to_y, y_to_lat};
use crate::jsmath;
use std::sync::Arc as Rc;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RegionsNeeded;

fn sides_val(battle: &Battle) -> Val {
    Val::Arr(battle.sides.iter().map(|members| Val::Arr(members.iter().map(|member| Val::str(member)).collect())).collect())
}

fn say(battle: &mut Battle, day: f64, id: &str, name: Val, was: Option<Val>) {
    let was = was.unwrap_or_else(|| name.clone());
    let id = Val::str(id);
    if let Some(recorder) = battle.recorder.as_mut() {
        recorder.shown(day, &id, &name, Some(&was));
    }
    battle.said.push(Val::Arr(vec![Val::Num(day), id, name, was]));
}

pub struct Grown {
    pub was: Frame,
    pub carry: Carrier,
}

pub fn start_recorder(battle: &mut Battle, run: &Run, day: f64, grown: Option<&Grown>) {
    let (cols, rows) = (battle.frame.cols, battle.frame.rows);
    let mut homes = battle.homes.clone().unwrap_or_default();
    let mut carried = None;
    if let (Some(grown), Some(recorder), Some(drawn)) = (grown, battle.recorder.as_ref(), battle.drawn_homes.as_ref()) {
        let was_cols = grown.was.cols;
        let cell_of = |cell: usize| -> f64 {
            let [x, y] = grown.carry.at((cell as f64 % was_cols) + 0.5, (cell as f64 / was_cols).floor() + 0.5);
            if x >= 0.0 && y >= 0.0 && x < cols && y < rows {
                y.floor() * cols + x.floor()
            } else {
                -1.0
            }
        };
        for (cell, &home) in drawn.iter().enumerate() {
            let there = cell_of(cell);
            if there >= 0.0 {
                homes[there as usize] = home;
            }
        }
        let field = battle.field.as_ref().unwrap();
        let ground = Ground { holders: &field.holders, homes: Some(&homes), painters: Some(&field.painter), when: None };
        carried = recorder.carry_onto(&sides_val(battle), cols, rows, cell_of, |x, y| grown.carry.at(x, y), &ground, day);
    }
    let is_carried = carried.is_some();
    battle.recorder = Some(carried.unwrap_or_else(|| create_replay_recorder(&sides_val(battle), cols, rows)));
    battle.drawn_homes = if is_carried { Some(homes) } else { battle.homes.clone() };
    let arena = battle.arena.clone();
    for region in 1..arena.ids.len() {
        let id = &arena.ids[region];
        let name = battle.shown.get(id).cloned().unwrap_or(Val::Undef);
        let name = if name.is_nullish() { Val::str("") } else { name };
        let side = battle.region_side.as_ref().map(|sides| sides[region]).unwrap_or(-1);
        if side >= 0 && name.truthy() && js::lower(&name.string_or_empty()) != js::lower(&holder_of(battle, run, id)) {
            say(battle, day, id, name, None);
        }
    }
}

pub struct Today {
    pub day: f64,
    pub line: Line,
    pub sectors: Rc<Sectors>,
}

pub fn prepare(battle: &mut Battle, day: f64) -> Today {
    let field = battle.field.as_mut().unwrap();
    let contour = trace_contour(field);
    let line = measure_line(field, &contour);
    let known = matches!(&battle.sectors_for, Some(seen) if Rc::ptr_eq(seen, &contour));
    if !known || battle.sectors.is_none() {
        battle.sectors = Some(Rc::new(read_sectors(&contour, line.count())));
        battle.sectors_for = Some(contour.clone());
    }
    battle.line_km = line.measured.total;
    for side in 0..2 {
        let radius = battle.radius_km[side];
        for index in 0..battle.troops[side].len() {
            if battle.troops[side][index].drawn {
                continue;
            }
            let troop = &mut battle.troops[side][index];
            draw_traits(troop, &battle.seed, &battle.name, side as f64, index as f64, battle.even);
            troop.radius_km = radius;
        }
    }
    let key = [
        battle.field.as_ref().unwrap().edits as f64,
        battle.orders_changed,
        battle.troops[0].len() as f64,
        live_count(&battle.troops[0]) as f64,
        battle.troops[1].len() as f64,
        live_count(&battle.troops[1]) as f64,
        day,
    ]
    .iter()
    .map(|&part| js::number_to_string(part))
    .collect::<Vec<String>>()
    .join("|");
    let sectors = battle.sectors.clone().unwrap();
    if battle.plan_key != key {
        read_orders(battle, &line.contour, line.count(), &sectors);
        battle.plan_key = key;
    }
    Today { day, line, sectors }
}

fn captor_of(battle: &Battle, run: &Run, region: usize, side: usize) -> String {
    let arena = &battle.arena;
    let sovereign = js::lower(js::trim(&run.sovereign_of(&arena.ids[region])));
    let lawful = battle.sides[side].iter().enumerate().position(|(index, member)| !battle.gone[side].contains(&index) && js::lower(member) == sovereign);
    if let Some(lawful) = lawful {
        return battle.sides[side][lawful].clone();
    }
    let mut near = vec![0.0f64; battle.sides[side].len()];
    for troop in &battle.troops[side] {
        if !is_live(troop) || (troop.owner >= 0.0 && battle.gone[side].contains(&(troop.owner as usize))) {
            continue;
        }
        let dx = troop.x - arena.centre_x[region];
        let dy = troop.y - arena.centre_y[region];
        if (dx * dx + dy * dy).sqrt() * battle.place.km_at(troop.y) <= CAPTOR_WITHIN_KM && troop.owner >= 0.0 && troop.owner.fract() == 0.0 {
            if let Some(slot) = near.get_mut(troop.owner as usize) {
                *slot += troop.strength;
            }
        }
    }
    let mut best: i64 = -1;
    for index in 0..near.len() {
        if battle.gone[side].contains(&index) {
            continue;
        }
        if best < 0 || near[index] > near[best as usize] {
            best = index as i64;
        }
    }
    if best >= 0 {
        battle.sides[side][best as usize].clone()
    } else {
        String::new()
    }
}

pub fn mop_up(battle: &mut Battle, run: &Run) -> bool {
    if run.braked {
        return false;
    }
    let arena = battle.arena.clone();
    let field = battle.field.as_ref().unwrap();
    let count = arena.ids.len();
    let mut held = [vec![0i32; count], vec![0i32; count]];
    let mut area = [vec![0.0f64; count], vec![0.0f64; count]];
    for index in 0..field.size {
        let holder = field.holders[index] as usize;
        if holder != 0 && holder != 1 {
            continue;
        }
        let km = battle.place.row_km.get(index / field.cols).copied().unwrap_or(f64::NAN);
        let region = arena.region[index] as usize;
        held[holder][region] += 1;
        area[holder][region] += km * km;
    }
    let region_side = battle.region_side.clone().unwrap();
    let mut taking = vec![-1i8; count];
    let mut winning_back: Vec<usize> = Vec::new();
    let mut any = false;
    for region in 1..count {
        let owner = region_side[region];
        if owner < 0 {
            continue;
        }
        let shown = battle.shown.get(&arena.ids[region]).map(|name| name.string_or_empty()).unwrap_or_default();
        let shown_side = side_of_name(battle, &shown);
        for side in 0..2usize {
            if held[1 - side][region] == 0 || !(area[1 - side][region] < PATCH_MAX_KM2) {
                continue;
            }
            let mine = held[side][region] as f64 + if owner as usize == side { arena.outside[region] } else { 0.0 };
            if mine / (arena.cells[region] as f64 + arena.outside[region]) < WHOLE_AT {
                continue;
            }
            taking[region] = side as i8;
            if side as i64 == shown_side {
                winning_back.push(region);
            }
            any = true;
        }
    }
    if !any {
        return false;
    }
    if !winning_back.is_empty() {
        let reach = REACH_KM / battle.frame.km;
        for &region in &winning_back {
            let side = taking[region];
            if side < 0 {
                continue;
            }
            for troop in &battle.troops[1 - side as usize] {
                if !is_live(troop) {
                    continue;
                }
                let dx = troop.x - arena.centre_x[region];
                let dy = troop.y - arena.centre_y[region];
                let span = (arena.cells[region] as f64 / 3.0).sqrt() + reach;
                if dx * dx + dy * dy <= span * span {
                    taking[region] = -1;
                    break;
                }
            }
        }
    }
    for side in 0..2usize {
        for troop in &battle.troops[side] {
            if !is_live(troop) || !stands(field, side as u8, troop.x, troop.y) {
                continue;
            }
            let region = arena.region[(troop.y.floor() * field.cols as f64 + troop.x.floor()) as usize] as usize;
            if taking[region] == 1 - side as i8 {
                taking[region] = -1;
            }
        }
    }
    let mut cells: [Vec<usize>; 2] = [Vec::new(), Vec::new()];
    for index in 0..field.size {
        let region = arena.region[index] as usize;
        let side = taking[region];
        if side < 0 || field.holders[index] as i8 != 1 - side {
            continue;
        }
        let side = side as usize;
        let mut spared = battle.kept[side].as_ref().map(|kept| kept.get(index).copied() == Some(1)).unwrap_or(false);
        let discs = &battle.spared[side];
        let mut at = 0;
        while at < discs.len() && !spared {
            let dx = (index % field.cols) as f64 + 0.5 - discs[at];
            let dy = (index / field.cols) as f64 + 0.5 - discs.get(at + 1).copied().unwrap_or(f64::NAN);
            let radius = discs.get(at + 2).copied().unwrap_or(f64::NAN);
            spared = dx * dx + dy * dy <= radius * radius;
            at += 3;
        }
        if spared {
            taking[region] = -2;
        } else {
            cells[side].push(index);
        }
    }
    let mut taken = false;
    let mut field = battle.field.take().unwrap();
    for side in 0..2usize {
        let mine: Vec<usize> = cells[side].iter().copied().filter(|&index| taking[arena.region[index] as usize] == side as i8).collect();
        if mine.is_empty() {
            continue;
        }
        let mut painter: Vec<(usize, f64)> = Vec::new();
        let battle_ref: &Battle = battle;
        let mut paint = |index: usize| -> f64 {
            let region = arena.region[index] as usize;
            if let Some((_, known)) = painter.iter().find(|(seen, _)| *seen == region) {
                return *known;
            }
            let name = if region_side[region] as i64 == side as i64 { holder_of(battle_ref, run, &arena.ids[region]) } else { captor_of(battle_ref, run, region, side) };
            let value = jsmath::max(0.0, member_index(battle_ref, side, &name) as f64);
            painter.push((region, value));
            value
        };
        take_cells(&mut field, side as u8, &mine, Painter::By(&mut paint));
        taken = true;
    }
    battle.field = Some(field);
    taken
}

pub fn region_changed(battles: &mut [Battle], run: &Run, id: &str) {
    for battle in battles.iter_mut() {
        if battle.status == "closed" || !battle.arena.index_of.contains_key(id) {
            continue;
        }
        read_region(battle, run, id);
        battle.plan_key = String::new();
    }
}

pub fn settle_regions(run: &mut Run, battles: &mut [Battle], index: usize, day: f64) {
    let battle = &mut battles[index];
    let turns = battle.field.as_ref().unwrap().turns as f64;
    if battle.settled_turns == turns {
        return;
    }
    battle.settled_turns = turns;
    let date = run.date_of(day);
    let arena = battle.arena.clone();
    for (at, city) in arena.cities.iter().enumerate() {
        let holder = battle.field.as_ref().unwrap().holders[city.cell as usize] as i8;
        let holders = battle.city_holder.as_mut().unwrap();
        let before = holders[at];
        holders[at] = holder;
        if holder == before || (holder != 0 && holder != 1) || (before != 0 && before != 1) {
            continue;
        }
        battle.log.push(Val::obj([("d", Val::str(&date)), ("k", Val::str("city")), ("s", Val::Num(holder as f64)), ("at", Val::Str(format!("city: {}", city.name)))]));
        battle.cities_taken[holder as usize].push(Val::str(&city.name));
    }
    let count = arena.ids.len();
    let mut held = [vec![0i32; count], vec![0i32; count]];
    {
        let field = battle.field.as_ref().unwrap();
        for at in 0..field.size {
            let holder = field.holders[at] as usize;
            if holder == 0 || holder == 1 {
                held[holder][arena.region[at] as usize] += 1;
            }
        }
    }
    for region in 1..count {
        let owner = battles[index].region_side.as_ref().unwrap()[region];
        if owner < 0 || run.braked {
            continue;
        }
        let taker = 1 - owner as usize;
        if held[taker][region] as f64 / (arena.cells[region] as f64 + arena.outside[region]) <= FLIP_AT {
            continue;
        }
        if day - (battles[index].last_flip[region] as f64) < MIN_DAYS_BETWEEN_FLIPS {
            battles[index].settled_turns = -1.0;
            continue;
        }
        let id = arena.ids[region].clone();
        let captor = captor_of(&battles[index], run, region, taker);
        if captor.is_empty() {
            continue;
        }
        let group = run.group_of(&id);
        let controller = run.controller_of(&id);
        let flip = |from: &str, kind: &str| Val::obj([("day", Val::Num(day)), ("date", Val::str(&date)), ("battlefield", Val::obj([("battle", Val::Num(index as f64))])), ("regionId", Val::str(&id)), ("from", Val::str(from)), ("to", Val::str(&captor)), ("kind", Val::str(kind))]);
        let grouped = !group.is_empty() && side_of_name(&battles[index], &group) == owner as i64;
        if run.is_group(&captor) {
            run.flips.push(flip(if grouped { &group } else { &controller }, "groupTake"));
            run.set_group(&id, &captor);
        } else {
            if grouped {
                run.flips.push(flip(&group, "groupRelease"));
                run.set_group(&id, "");
            }
            if side_of_name(&battles[index], &controller) != taker as i64 {
                run.flips.push(flip(&controller, "control"));
                run.set_controller(&id, &captor);
            }
        }
        battles[index].last_flip[region] = day as i32;
        if arena.names[region] != id {
            battles[index].taken[taker].push(Val::str(&arena.names[region]));
        }
        if !run.rehearsing {
            region_changed(battles, run, &id);
        }
        run.spend_flip();
        let shown = battles[index].shown.get(&id).cloned().unwrap_or(Val::Undef);
        say(&mut battles[index], day, &id, shown, None);
    }
    let battle = &mut battles[index];
    let mut member = vec![-1i16; count];
    let mut any = false;
    for region in 1..count {
        let side = battle.region_side.as_ref().unwrap()[region];
        if side < 0 || arena.cells[region] == 0 || held[side as usize][region] != arena.cells[region] {
            continue;
        }
        let id = arena.ids[region].clone();
        let name = holder_of(battle, run, &id);
        let was = battle.shown.get(&id).cloned().unwrap_or(Val::Undef);
        let was = if was.is_nullish() { Val::str("") } else { was };
        if name.is_empty() || js::lower(&was.string_or_empty()) == js::lower(&name) {
            continue;
        }
        battle.shown.set(id.clone(), Val::str(&name));
        member[region] = jsmath::max(0.0, member_index(battle, side as usize, &name) as f64) as i16;
        any = true;
        say(battle, day, &id, Val::str(&name), Some(was));
        if arena.names[region] != id {
            battle.log.push(Val::obj([("d", Val::str(&date)), ("k", Val::str("whole")), ("s", Val::Num(side as f64)), ("at", Val::Str(format!("region: {}", arena.names[region])))]));
        }
    }
    if !any {
        return;
    }
    let region_side = battle.region_side.clone().unwrap();
    let homes = battle.homes.as_mut().unwrap();
    let field = battle.field.as_mut().unwrap();
    for at in 0..field.size {
        let region = arena.region[at] as usize;
        if member[region] < 0 {
            continue;
        }
        homes[at] = region_side[region] as u8;
        field.painter[at] = member[region] as u8;
    }
}

fn grow_within(battle: &mut Battle, run: &Run) -> f64 {
    let known = matches!(&battle.within_for, Some(arena) if Rc::ptr_eq(arena, &battle.arena));
    if !known {
        let mut fastest = 0.0f64;
        for &speed in &battle.arena.speed {
            if speed as f64 > fastest {
                fastest = speed as f64;
            }
        }
        let mut least = f64::INFINITY;
        for &km in &battle.place.row_km {
            if km < least {
                least = km;
            }
        }
        let step_km = jsmath::max(jsmath::max(run.advance_km[0], run.advance_km[1]), run.advance_km[2]) * run.pace * TRAIT_DRIVE[1] * fastest;
        battle.within = jsmath::max(GROW_WITHIN_CELLS, (step_km / least).ceil() + 2.0);
        battle.within_for = Some(battle.arena.clone());
    }
    battle.within
}

fn edges_to_grow(field: &mut Field, within: f64) -> Option<[bool; 4]> {
    let contour = trace_contour(field);
    let (cols, rows) = (field.cols as f64, field.rows as f64);
    let play = &field.play;
    let land_by = |from: f64, to: f64, at: f64, upright: bool| -> bool {
        let mut step = jsmath::max(0.0, from.floor());
        let last = jsmath::min((if upright { rows } else { cols }) - 1.0, to.floor());
        while step <= last {
            let cell = if upright { step * cols + at } else { at * cols + step };
            if play[cell as usize] != 0 {
                return true;
            }
            step += 1.0;
        }
        false
    };
    let mut grow = [false; 4];
    for vertex in 0..contour.x.len() {
        let x = contour.x[vertex];
        let y = contour.y[vertex];
        let span = within + 2.0;
        if !grow[0] && x < within && land_by(y - span, y + span, 0.0, true) {
            grow[0] = true;
        }
        if !grow[2] && x > cols - within && land_by(y - span, y + span, cols - 1.0, true) {
            grow[2] = true;
        }
        if !grow[1] && y < within && land_by(x - span, x + span, 0.0, false) {
            grow[1] = true;
        }
        if !grow[3] && y > rows - within && land_by(x - span, x + span, rows - 1.0, false) {
            grow[3] = true;
        }
    }
    if grow.iter().any(|&edge| edge) {
        Some(grow)
    } else {
        None
    }
}

pub fn larger_frame(frame: &Frame, grow: [bool; 4], map: &Val, within: f64) -> Option<Frame> {
    let more = jsmath::max(within * 2.0, jsmath::round(GROW_KM / frame.km));
    let west = if grow[0] { more } else { 0.0 };
    let south = if grow[1] { more } else { 0.0 };
    let cols = frame.cols + west + if grow[2] { more } else { 0.0 };
    let rows = frame.rows + south + if grow[3] { more } else { 0.0 };
    let y0 = lat_to_y(frame.lat0) - south * frame.cell;
    if cols <= MAX_GRID_SPAN && rows <= MAX_GRID_SPAN && cols * rows <= MAX_CELLS && y0 > lat_to_y(-85.0) {
        return Some(Frame { lng0: frame.lng0 - west * frame.cell, lat0: y_to_lat(y0), cols, rows, ..frame.clone() });
    }
    let bounds = frame_bounds(frame);
    let place = Projector::of(frame);
    let [_, low_lat] = place.to_lng_lat(0.0, -south);
    let [_, high_lat] = place.to_lng_lat(0.0, rows - south);
    let scale = if map.get("scale").is_undef() { KM_PER_DEGREE } else { map.get("scale").num() };
    create_frame(Bounds { west: bounds.west - west * frame.cell, east: bounds.west + (cols - west) * frame.cell, south: low_lat, north: high_lat }, map.get("flat").is_true(), scale, 0.0)
}

#[derive(Clone, Copy, Debug)]
pub struct Carrier {
    pub scale: f64,
    pub shift_x: f64,
    pub shift_y: f64,
}

impl Carrier {
    pub fn at(&self, x: f64, y: f64) -> [f64; 2] {
        [x * self.scale + self.shift_x, y * self.scale + self.shift_y]
    }
}

pub fn carrier(from: &Frame, to: &Frame) -> Carrier {
    let scale = from.cell / to.cell;
    let apart = from.lng0 + (from.cols * from.cell) / 2.0 - (to.lng0 + (to.cols * to.cell) / 2.0);
    let shift_x = (from.lng0 - to.lng0 - 360.0 * jsmath::round(apart / 360.0)) / to.cell;
    let shift_y = (lat_to_y(from.lat0) - lat_to_y(to.lat0)) / to.cell;
    Carrier { scale, shift_x, shift_y }
}

pub fn grow_if_needed(battle: &mut Battle, run: &mut Run, day: f64) -> Result<bool, RegionsNeeded> {
    if battle.grown >= 6.0 {
        return Ok(false);
    }
    let within = grow_within(battle, run);
    let Some(grow) = edges_to_grow(battle.field.as_mut().unwrap(), within) else { return Ok(false) };
    grow_frame(battle, run, day, grow, within, true)
}

pub fn grow_to_hold(battle: &mut Battle, run: &mut Run, day: f64, lng: f64, lat: f64) -> Result<bool, RegionsNeeded> {
    let within = grow_within(battle, run);
    let mut turn = 0.0;
    while turn <= OBJECTIVE_GROWS_MOST {
        let [x, y] = battle.place.to_cell(lng, lat);
        if !x.is_finite() || !y.is_finite() {
            return Ok(false);
        }
        let (cols, rows) = (battle.frame.cols, battle.frame.rows);
        let grow = [x < within, y < within, x > cols - within, y > rows - within];
        if !grow.iter().any(|&edge| edge) {
            return Ok(true);
        }
        if turn == OBJECTIVE_GROWS_MOST || !grow_frame(battle, run, day, grow, within, false)? {
            return Ok(false);
        }
        turn += 1.0;
    }
    Ok(false)
}

fn carry_order(order: &mut Val, carry: &Carrier, scale: f64) {
    if !order.truthy() || !order.is_object() {
        return;
    }
    let mut legs = order.read("legs");
    if let Val::Arr(list) = &mut legs {
        for leg in list.iter_mut() {
            let [x, y] = carry.at(leg.read("ox").num(), leg.read("oy").num());
            leg.write("ox", Val::Num(x));
            leg.write("oy", Val::Num(y));
            let length = leg.read("length").num() * scale;
            leg.write("length", Val::Num(length));
        }
        order.write("legs", legs);
    }
    let slot = order.read("slot");
    if !slot.is_undef() {
        order.write("slot", Val::Num(slot.num() * scale));
    }
    let mut entry = order.read("entry");
    if entry.truthy() && entry.is_object() {
        let [x, y] = carry.at(entry.read("x").num(), entry.read("y").num());
        entry.write("x", Val::Num(x));
        entry.write("y", Val::Num(y));
        order.write("entry", entry);
    }
    let target = order.read("target");
    if target.truthy() && target.is_object() {
        let mut moved = match &target {
            Val::Ref(cell) => Val::Obj(cell.borrow().clone()),
            other => other.clone(),
        };
        let [x, y] = carry.at(target.read("x").num(), target.read("y").num());
        moved.write("x", Val::Num(x));
        moved.write("y", Val::Num(y));
        order.write("target", moved);
    }
    let mut resume = order.read("resume");
    if resume.truthy() && resume.is_object() {
        carry_order(&mut resume, carry, scale);
        order.write("resume", resume);
    }
}

fn grow_frame(battle: &mut Battle, run: &mut Run, day: f64, grow: [bool; 4], within: f64, counted: bool) -> Result<bool, RegionsNeeded> {
    let Some(frame) = larger_frame(&battle.frame, grow, run.input.get("map"), within) else { return Ok(false) };
    if frame.cols == battle.frame.cols && frame.rows == battle.frame.rows && frame.cell == battle.frame.cell {
        return Ok(false);
    }
    let input = run.input.clone();
    let arena = match arena_for(&mut run.arenas, input.get("map"), &frame, input.get("regionTypes")) {
        Some(arena) => arena,
        None => return Err(RegionsNeeded),
    };
    let carry = carrier(&battle.frame, &frame);
    let was = battle.frame.clone();
    let old = battle.field.take().unwrap();
    let before_arena = battle.arena.clone();
    let before_flip = battle.last_flip.clone();
    let before_pockets = battle.pockets.clone();
    let before_cell = battle.frame.cell;
    if counted {
        battle.grown += 1.0;
    }
    battle.frame = frame;
    battle.arena = arena.clone();
    battle.place = Projector::of(&battle.frame);
    read_regions(battle, run);
    let region_side: Vec<i32> = battle.region_side.as_ref().unwrap().iter().map(|&side| side as i32).collect();
    let ice: Option<Vec<i32>> = battle.ice_side.as_ref().map(|ice| ice.iter().map(|&side| side as i32).collect());
    battle.field = Some(resample_field(&old, arena.clone(), &region_side, ice.as_deref()));
    let mut began_from = old.clone();
    if let Some(phi) = &battle.start_phi {
        began_from.phi = phi.clone();
    }
    let began = resample_field(&began_from, arena.clone(), &region_side, ice.as_deref());
    battle.start_phi = Some(began.phi);
    battle.start_holders = Some(began.holders);
    let scale = if battle.frame.cell != 0.0 { before_cell / battle.frame.cell } else { 1.0 };
    for side in 0..2 {
        for troop in battle.troops[side].iter_mut() {
            let [x, y] = carry.at(troop.x, troop.y);
            troop.x = x;
            troop.y = y;
            troop.station = None;
            if troop.fallback.truthy() {
                let [x, y] = carry.at(troop.fallback.element(0).num(), troop.fallback.element(1).num());
                troop.fallback = Val::nums(&[x, y]);
            }
            carry_order(&mut troop.order, &carry, scale);
        }
    }
    battle.close = None;
    battle.to_side = None;
    battle.anchors = battle
        .anchors
        .iter()
        .map(|anchor| {
            let [x, y] = carry.at(anchor.read("x").num(), anchor.read("y").num());
            Val::obj([("s", anchor.read("s")), ("x", Val::Num(x)), ("y", Val::Num(y))])
        })
        .collect();
    battle.pockets = before_pockets
        .iter()
        .map(|pocket| {
            let [x, y] = carry.at((pocket.cell % old.cols as f64) + 0.5, (pocket.cell / old.cols as f64).floor() + 0.5);
            let mut moved = pocket.clone();
            moved.cell = y.floor() * arena.cols as f64 + x.floor();
            moved
        })
        .collect();
    battle.pocket_of = None;
    battle.pocket_turns = -1.0;
    battle.sieges = Vec::new();
    battle.spared = [Vec::new(), Vec::new()];
    battle.siege_key = String::new();
    battle.supply = None;
    battle.supply_turns = -1.0;
    battle.claims = Claims { stamp: vec![0; arena.size], power: vec![0.0; arena.size], moment: 0.0 };
    battle.last_flip = vec![-1000000; arena.ids.len()];
    for region in 1..before_arena.ids.len() {
        if let Some(&now) = arena.index_of.get(&before_arena.ids[region]) {
            battle.last_flip[now] = before_flip[region];
        }
    }
    let holders = &battle.field.as_ref().unwrap().holders;
    battle.city_holder = Some(arena.cities.iter().map(|city| holders[city.cell as usize] as i8).collect());
    battle.settled_turns = -1.0;
    battle.plan_key = String::new();
    battle.sectors_for = None;
    battle.climate_lat = None;
    battle.zones_for = false;
    battle.walls_for = false;
    battle.wall_sides = String::new();
    battle.taken_for = false;
    battle.look = None;
    battle.retreat = None;
    paint_ground(battle, run);
    start_recorder(battle, run, day, Some(&Grown { was, carry }));
    Ok(true)
}

pub fn record_day(battle: &mut Battle, day: f64, last: bool) {
    if last {
        battle.drawn_homes = battle.homes.clone();
    }
    let troops: Vec<Vec<TrackIn>> = battle.troops.iter().map(|list| list.iter().map(|troop| TrackIn { strength: troop.strength, x: troop.x, y: troop.y, state: troop.state }).collect()).collect();
    let field = battle.field.as_ref().unwrap();
    let when: Vec<f64> = field.when.iter().map(|&value| value as f64).collect();
    let ground = Ground { holders: &field.holders, homes: battle.drawn_homes.as_deref(), painters: Some(&field.painter), when: Some(&when) };
    if let Some(recorder) = battle.recorder.as_mut() {
        recorder.record(day, &troops, Some(&ground));
    }
    battle.recorded = day;
    battle.said = Vec::new();
}

pub fn simulate_day(run: &mut Run, index: usize, day: f64) -> Result<f64, RegionsNeeded> {
    let date = run.date_of(day);
    let mut battles = std::mem::take(&mut run.battles);
    let steps = {
        let battle = &mut battles[index];
        let today = prepare(battle, day);
        if today.line.count() == 0 {
            let held = count_holders(battle.field.as_ref().unwrap());
            battle.closing = if held[0] == 0.0 || held[1] == 0.0 { "taken".to_string() } else { "apart".to_string() };
            run.battles = battles;
            return Ok(0.0);
        }
        measure(battle.field.as_ref().unwrap(), &mut battle.to_side);
        mark_pockets(battle);
        find_prey(battle);
        mark_supply(battle);
        move_day(battle, run, day);
        let pace = run.advance_km;
        let steps = step_forward(run, battle, &pace, run.pace);
        settle_pockets(battle, &date);
        redistance(battle.field.as_mut().unwrap());
        steps
    };
    run.battles = battles;
    dusk(run, index, day);
    let mut battle = run.lend(index);
    close_day(run, &mut battle);
    if mop_up(&mut battle, run) {
        redistance(battle.field.as_mut().unwrap());
    }
    age_orders(&mut battle);
    refresh_supply(&mut battle, day, run.era);
    run.give(index, battle);
    let mut battles = std::mem::take(&mut run.battles);
    settle_regions(run, &mut battles, index, day);
    let grown = grow_if_needed(&mut battles[index], run, day);
    run.battles = battles;
    grown?;
    Ok(steps)
}
