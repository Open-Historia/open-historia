use super::air::wing_changes;
use super::arena::{arena_for, Arena};
use super::attrition::attrition_report;
use super::battle::{absorb_unit, finished_val, holder_of, is_land_formation, keep_start, line_length, load_battle, member_index, member_weights, open_battle, paint_ground, raise_troops, reconcile, release_named, save_battle, set_handicap, set_radii, side_of_name, Battle, Opened};
use super::brief::build_brief;
use super::codec::hash_key;
use super::command::assign_commands;
use super::constants::{takers_for, BATTLEFIELD_NAME_MAX, BREAKTHROUGH_LOOK_DAYS, EFFORT_FACTORS, FRONT_EFFORTS, FRONT_ORDERS, HAND_OVER_REACH_CELLS, INVADE_REACH_KM, LANDING_CELLS, MAX_BATTLEFIELDS, MAX_CLOSED_BATTLEFIELDS, MAX_HOME_FORCES, MAX_SIDE_MEMBERS, MUSTER_STANDING_SHARE, MAX_TROOPS_PER_SIDE, MIND_MARK, OBJECTIVE_BEYOND_KM, POOL_PER_TROOP, REINFORCED_LINE_MOST, REINFORCED_SIZE_MOST, REINFORCE_MOST, REINFORCE_ORDER, REINFORCE_USUAL_SHARE, SCENARIO_MARK, STAFF_MARK, STAFF_REVIEW_DAYS, STANDING_QUIET_DAYS, STORY_TAKER_REACH_KM, TROOPS_PER_STRENGTH, TROOP_KINDS, WAR_EFFORTS, WITHDRAW_DAYS_MOST, WITHDRAW_KM};
use super::contact::{contact_at, find_contacts, frame_for_contact, middle_of};
use super::dawn::dawn;
use super::day::{grow_to_hold, prepare, record_day, settle_regions, simulate_day, start_recorder, RegionsNeeded, Today};
use super::deploy::{deploy_cells, Call, Last, DEPLOY_WHY};
use super::engine::{clean, clean_text, create_run, fold, fold_text, member_list, Asked, Body, Hooks, Own, Run, Said, StaffHook, War};
use super::field::{redistance, take_capsule, trace_contour, Field, How};
use super::frame::{create_frame, point_in_frame, Frame};
use super::game_dates::{compare_game_dates, diff_game_days, game_date_year};
use super::ground::{cell_at as field_cell_at, downhill, measure};
use super::invade::{land_within, others_on_way};
use super::js::{self, Obj, Val};
use super::manpower::{draw, formations_left, formations_left_with, manpower_report, men_of, part_left, part_left_with, send_home};
use super::mechanics::any_of;
use super::military::{air_worth, land_worth, mix_of, sea_worth};
use super::muster::{levy_owed, muster_share, Levy};
use super::march::{march_km_of, march_on, marches_for, send_inland, walk_route, CALL_UP_FULL_DAYS};
use super::home::{border_cells, home_bounds, home_cells as cells_round_cities, home_name, home_neighbours, way_into, HOME_JOIN_KM, HOME_MARGIN_KM};
use super::air_strike::bomb_troops;
use super::closing::live_order;
use super::orders::{apply_order, assign_order, give_way, land_carried, put_ashore, read_sieges, set_standing_order, standing_of, OrderDay};
use super::record::{fold_battlefield_name, frame_from, is_war_id_name, normalize_battlefields};
use super::region_types::water_type_ids;
use super::scenario_fronts::authored_name;
use super::sectors::{describe_point, find_place, in_sector, resolve_sector, Sector};
use super::staff::{breakthrough_answer, side_is_played, staff_decision, staff_may_order, staff_standing};
use super::supply::find_pockets;
use super::swarms::gather_newcomers;
use super::transports::{bound_for, interception_of, load_of, move_on, normalize_transports, set_out, struck, transport_chance, transport_val, Place, SetOut, Transport, Watch, TRANSPORT_ENDED};
use super::troops::{create_troop, is_live, kinds_for, live_count, troops_cap, troops_least, troops_wanted, TroopSeed, STATE_HOLDING};
use super::unit_motion::year_in_era;
use super::walls::lines_changed;
use super::world_grid::{build_world_grid, km_between, measure_of, place_along, world_sheet_key, GridOptions, Surface, WorldGrid};
use crate::jsmath;
use std::collections::{HashMap, HashSet};
use std::sync::Arc as Rc;

type Flow<T> = Result<T, RegionsNeeded>;

const ATTACK_ORDERS: [&str; 7] = ["advance", "blitz", "spearhead", "flank", "encircle", "assault", "land"];
const STANDING_REACH_KM: f64 = 300.0;
const REST_KM: f64 = 20.0;
const OWN_GRID: &str = "\u{0}own";

fn is_attack_word(word: &Val) -> bool {
    matches!(word, Val::Str(text) if ATTACK_ORDERS.contains(&text.as_str()))
}

fn word_in(word: &Val, list: &[&str]) -> bool {
    matches!(word, Val::Str(text) if list.contains(&text.as_str()))
}

fn word_is(word: &Val, wanted: &str) -> bool {
    matches!(word, Val::Str(text) if text == wanted)
}

fn num(value: f64) -> Val {
    Val::Num(value)
}

fn text(value: &str) -> Val {
    Val::Str(value.to_string())
}

fn sum_of(values: &[f64]) -> f64 {
    values.iter().fold(0.0, |sum, &value| sum + value)
}

fn effort_factor(name: &str) -> f64 {
    EFFORT_FACTORS.iter().find(|(key, _)| *key == name).map(|(_, value)| *value).unwrap_or(f64::NAN)
}

fn lend(run: &mut Run, at: usize) -> Battle {
    run.lend(at)
}

fn give(run: &mut Run, at: usize, battle: Battle) {
    run.give(at, battle);
}

fn settle(run: &mut Run, at: usize, day: f64) {
    let mut battles = std::mem::take(&mut run.battles);
    settle_regions(run, &mut battles, at, day);
    run.battles = battles;
}

fn battle_ref(at: usize) -> Val {
    Val::obj([("battle", num(at as f64))])
}

fn order_day<'a>(today: &'a Today, date: &'a str) -> OrderDay<'a> {
    OrderDay { day: today.day, date, contour: &today.line.contour, count: today.line.count(), sectors: &today.sectors }
}

fn lead_of(battle: &Battle, side: usize) -> String {
    battle.sides[side].iter().enumerate().find(|(at, _)| !battle.gone[side].contains(at)).map(|(_, member)| member.clone()).unwrap_or_default()
}

fn regions_of(run: &Run) -> Option<&Vec<Val>> {
    run.input.get("map").get("regions").as_array()
}

fn open_battles(run: &Run) -> usize {
    run.battles.iter().filter(|battle| battle.status != "closed" && !battle.home).count()
}

fn players_have(run: &Run, name: &Val) -> bool {
    let wanted = fold(name);
    run.input.get("players").array_or_empty().iter().any(|player| fold(player) == wanted)
}

fn war_side(war: &War, name: &str) -> i64 {
    let wanted = fold_text(name);
    if war.sides[0].iter().any(|member| fold_text(member) == wanted) {
        0
    } else if war.sides[1].iter().any(|member| fold_text(member) == wanted) {
        1
    } else {
        -1
    }
}

fn side_or_none(side: i64) -> Option<usize> {
    if side >= 0 {
        Some(side as usize)
    } else {
        None
    }
}

fn war_side_of(run: &Run, war: &War, id: &str) -> i64 {
    let side_of = |name: &str| {
        if fold_text(name).is_empty() {
            -1
        } else {
            war_side(war, name)
        }
    };
    let group = side_of(&run.group_of(id));
    if group >= 0 {
        group
    } else {
        side_of(&run.controller_of(id))
    }
}

fn battle_side(battle: &Battle, side: usize) -> usize {
    if battle.swap {
        1 - side
    } else {
        side
    }
}

fn war_of(run: &Run, id: &str) -> Option<War> {
    run.wars.get(&id.to_string()).cloned()
}

fn war_id_of(battle: &Battle) -> String {
    match &battle.war_id {
        Val::Str(id) => id.clone(),
        _ => String::new(),
    }
}

fn is_of_war(battle: &Battle, id: &str) -> bool {
    matches!(&battle.war_id, Val::Str(own) if own == id)
}

fn peace_of(owner: &str, others: Vec<String>) -> War {
    War { id: String::new(), title: String::new(), status: "active".to_string(), sides: [vec![owner.to_string()], others], began: String::new() }
}

fn arena_at(run: &mut Run, frame: &Frame) -> Option<Rc<Arena>> {
    let input = run.input.clone();
    let map = input.get("map");
    let types = input.get("regionTypes");
    arena_for(&mut run.arenas, map, frame, types)
}

fn name_for(run: &Run, battle: &mut Battle) -> String {
    let arena = battle.arena.clone();
    let mut lead: [String; 2] = [String::new(), String::new()];
    for side in 0..2 {
        let mut cells = vec![0.0f64; battle.sides[side].len()];
        for region in 1..arena.ids.len() {
            let id = &arena.ids[region];
            let group = run.group_of(id);
            let holder = if group.is_empty() { run.controller_of(id) } else { group };
            let wanted = fold_text(&holder);
            if let Some(index) = battle.sides[side].iter().position(|member| fold_text(member) == wanted) {
                cells[index] += arena.cells[region] as f64;
            }
        }
        let mut best = 0;
        for index in 1..cells.len() {
            if cells[index] > cells[best] {
                best = index;
            }
        }
        lead[side] = battle.sides[side].get(best).cloned().unwrap_or_else(|| "undefined".to_string());
    }
    let taken = |name: &str| run.battles.iter().any(|other| fold_battlefield_name(&text(&other.name)) == fold_battlefield_name(&text(name)));
    let sides = Val::Arr(battle.sides.iter().map(|members| Val::Arr(members.iter().map(|member| text(member)).collect())).collect());
    let authored = clean(&authored_name(run.input.get("authored"), &sides), BATTLEFIELD_NAME_MAX as usize);
    if !authored.is_empty() && !taken(&authored) {
        return authored;
    }
    let plain = clean_text(&format!("{} - {} front", lead[0], lead[1]), BATTLEFIELD_NAME_MAX as usize);
    if !taken(&plain) {
        return plain;
    }
    let contour = trace_contour(battle.field.as_mut().unwrap());
    let mut city: Option<usize> = None;
    for (at, candidate) in arena.cities.iter().enumerate() {
        let mut near = false;
        let mut vertex = 0;
        while vertex < contour.x.len() && !near {
            near = (contour.x[vertex] - candidate.x).abs() <= 12.0 && (contour.y[vertex] - candidate.y).abs() <= 12.0;
            vertex += 1;
        }
        if near && city.map_or(true, |best| candidate.population > arena.cities[best].population) {
            city = Some(at);
        }
    }
    let named = match city {
        Some(at) => clean_text(&format!("{} - {} front, {}", lead[0], lead[1], arena.cities[at].name), BATTLEFIELD_NAME_MAX as usize),
        None => String::new(),
    };
    if !named.is_empty() && !taken(&named) {
        return named;
    }
    let mut count = 2.0;
    loop {
        let numbered = clean_text(&format!("{} {}", plain, js::number_to_string(count)), BATTLEFIELD_NAME_MAX as usize);
        if !taken(&numbered) {
            return numbered;
        }
        count += 1.0;
    }
}

fn given_name(run: &Run, value: &Val) -> String {
    let name = clean(value, BATTLEFIELD_NAME_MAX as usize);
    let ids: Vec<Val> = run.wars.keys().map(|id| text(id)).collect();
    if !name.is_empty() && !is_war_id_name(&text(&name), &ids) {
        name
    } else {
        String::new()
    }
}

fn owner_of_unit(unit: &Val) -> Val {
    if unit.get("ownerCode").is_nullish() {
        unit.get("owner").clone()
    } else {
        unit.get("ownerCode").clone()
    }
}

fn absorb_units(run: &mut Run, battle: &mut Battle, at: usize) {
    let input = run.input.clone();
    let units = input.get("units").array_or_empty();
    for unit in units {
        let id = clean(unit.get("id"), 120);
        if id.is_empty() || !clean(unit.get("committedTo"), 120).is_empty() || run.taken.contains(&id) {
            continue;
        }
        if battle.sent_home.has(&id) {
            continue;
        }
        let side = side_of_name(battle, &owner_of_unit(unit).string_or_empty());
        if side >= 0 && battle.away[side as usize] {
            continue;
        }
        if absorb_unit(battle, run, at, unit, false) && !run.taken.contains(&id) {
            run.taken.push(id);
        }
    }
}

struct Landed {
    side: usize,
    x: f64,
    y: f64,
    load: Val,
    owner: f64,
}

fn start_battle(run: &mut Run, mut battle: Battle, day: f64, landed: Option<Landed>) -> usize {
    let at = run.battles.len();
    let handed = bring_home(run, &mut battle, day);
    raise_troops(&mut battle, run, None, landed.as_ref().map_or(-1, |landed| 1 - landed.side as i64));
    if let Some(landed) = &landed {
        battle.base[landed.side] = jsmath::round(sum_of(&member_weights(&battle, run, None, landed.side)) * 1000.0) / 1000.0;
        put_ashore(&mut battle, landed.side, landed.x, landed.y, &landed.load, landed.owner);
    }
    absorb_units(run, &mut battle, at);
    set_radii(&mut battle);
    paint_ground(&mut battle, run);
    keep_start(&mut battle);
    read_sieges(&mut battle);
    find_pockets(&mut battle);
    if handed.is_empty() {
        start_recorder(&mut battle, run, day, None);
        record_day(&mut battle, day, day >= run.days);
        run.battles.push(battle);
        return at;
    }
    run.battles.push(battle);
    home_orders(run, at, handed, day);
    let mut battle = lend(run, at);
    start_recorder(&mut battle, run, day, None);
    record_day(&mut battle, day, day >= run.days);
    give(run, at, battle);
    at
}

fn close_battle(run: &mut Run, at: usize, day: f64) {
    if run.battles[at].status == "closed" {
        return;
    }
    let mut battle = lend(run, at);
    let arena = battle.arena.clone();
    battle.status = "closed".to_string();
    battle.closed_date = run.date_of(day);
    for side in 0..2 {
        send_home(run, &battle, side, None);
    }
    release_named(&mut battle, run);
    let mut occupied: Vec<String> = Vec::new();
    let mut region = 1;
    while region < arena.ids.len() && occupied.len() < 12 {
        let id = &arena.ids[region];
        let controller = run.controller_of(id);
        let side = battle.region_side.as_ref().map_or(-1, |sides| sides[region]);
        if !(side < 0 || arena.names[region] == *id || fold_text(&controller) == fold_text(&run.sovereign_of(id))) {
            occupied.push(format!("region: {}", arena.names[region]));
        }
        region += 1;
    }
    run.notes.push(Val::obj([("kind", text("closed")), ("battlefield", battle_ref(at)), ("detail", text(&occupied.join(", ")))]));
    if battle.recorder.is_none() {
        start_recorder(&mut battle, run, day, None);
    }
    record_day(&mut battle, day, true);
    let finished = battle.recorder.as_ref().unwrap().finish(run.input.get("fromDate"), &num(day));
    battle.replay = Some(finished_val(&finished));
    battle.closing = String::new();
    give(run, at, battle);
}

fn land_regions_of(run: &mut Run) -> Option<Rc<Vec<Val>>> {
    if let Some(list) = &run.land_regions {
        return Some(list.clone());
    }
    let regions = regions_of(run)?;
    let water = water_type_ids(run.input.get("regionTypes"));
    let frozen: Option<Vec<Val>> = match run.input.get("map").get("frozen") {
        Val::Arr(list) if !list.is_empty() => Some(list.clone()),
        _ => None,
    };
    let list: Vec<Val> = if !water.is_empty() {
        regions
            .iter()
            .filter(|region| {
                let kind = clean(region.get("typeId"), 120);
                !water.contains(&kind) || frozen.as_ref().is_some_and(|ice| ice.iter().any(|id| js::same_value_zero(id, region.get("id"))))
            })
            .cloned()
            .collect()
    } else {
        regions.clone()
    };
    let list = Rc::new(list);
    run.land_regions = Some(list.clone());
    Some(list)
}

fn joined(values: &[Val], separator: &str) -> String {
    values.iter().map(|value| if value.is_nullish() { String::new() } else { js::to_string(value) }).collect::<Vec<String>>().join(separator)
}

fn contact_key(run: &Run, war: &War) -> String {
    let ids = match &run.region_ids {
        Val::Arr(ids) => ids,
        _ => return String::new(),
    };
    let frames: Vec<&Battle> = run.battles.iter().filter(|battle| is_of_war(battle, &war.id) && battle.status != "closed").collect();
    let covered = |id: &str| frames.iter().any(|battle| battle.arena.index_of.get(id).is_some_and(|&at| battle.arena.outside[at] == 0.0));
    let mut held: [Vec<String>; 2] = [Vec::new(), Vec::new()];
    for id in ids {
        let id = id.string_or_empty();
        let side = war_side_of(run, war, &id);
        if side >= 0 && !covered(&id) {
            held[side as usize].push(id);
        }
    }
    let frozen = match run.input.get("map").get("frozen") {
        Val::Arr(list) => {
            let mut sorted = list.clone();
            js::default_sort(&mut sorted);
            joined(&sorted, "\u{2}")
        }
        _ => String::new(),
    };
    let parts = [war.sides[0].join("\u{2}"), war.sides[1].join("\u{2}"), js::number_to_string(held[0].len() as f64), js::number_to_string(held[1].len() as f64), held[0].join("\u{2}"), held[1].join("\u{2}"), frozen];
    let parts: Vec<&str> = parts.iter().map(|part| part.as_str()).collect();
    format!("contact|{}|{}|{}", clean(run.input.get("map").get("key"), 120), war.id, hash_key(&parts))
}

fn holder_in(run: &Run, war: &War, id: &str) -> String {
    let group = run.group_of(id);
    if !group.is_empty() && war_side(war, &group) >= 0 {
        group
    } else {
        run.controller_of(id)
    }
}

fn kept(run: &Run, key: &str) -> bool {
    run.cache_on && run.kept_flags.contains(key)
}

fn keep(run: &mut Run, key: String) {
    if run.cache_on {
        run.kept_flags.insert(key);
    }
}

fn land_where_troops_stand(run: &mut Run, war: &War, day: f64) -> Flow<()> {
    if run.battles.iter().any(|battle| is_of_war(battle, &war.id) && battle.status != "closed") {
        return Ok(());
    }
    let mut standing: Vec<(String, f64, f64)> = Vec::new();
    for unit in run.input.get("units").array_or_empty() {
        let owner = clean(&owner_of_unit(unit), 120);
        let side = war_side(war, &owner);
        let region = clean(unit.get("regionId"), 120);
        let lng = js::to_number(unit.get("lng"));
        let lat = js::to_number(unit.get("lat"));
        if side < 0 || region.is_empty() || unit.get("covert").is_true() || !clean(unit.get("committedTo"), 120).is_empty() || !is_land_formation(unit) || !lng.is_finite() || !lat.is_finite() {
            continue;
        }
        if war_side(war, &holder_in(run, war, &region)) != 1 - side {
            continue;
        }
        standing.push((owner, lng, lat));
    }
    if standing.is_empty() {
        return Ok(());
    }
    let input = run.input.clone();
    let map = input.get("map");
    let surface = measure_of(&map);
    let near = |a: &(String, f64, f64), b: &(String, f64, f64)| km_between(a.1, a.2, b.1, b.2, surface) <= STANDING_REACH_KM;
    let mut best = 0;
    let mut most = 0;
    for (at, entry) in standing.iter().enumerate() {
        let count = standing.iter().filter(|other| near(entry, other)).count();
        if count > most {
            best = at;
            most = count;
        }
    }
    let (owner, lng, lat) = standing[best].clone();
    let tried = format!("standing|{}|{}|{}|{}|{}", clean(map.get("key"), 120), war.id, owner, js::number_to_string(lng), js::number_to_string(lat));
    if kept(run, &tried) {
        return Ok(());
    }
    if open_landing_at(run, war, &owner, lng, lat, &Val::str(""), day, None)?.is_none() {
        keep(run, tried);
    }
    Ok(())
}

fn examine_war(run: &mut Run, id: &str, day: f64) -> Flow<()> {
    let Some(war) = war_of(run, id) else { return Ok(()) };
    if war.status != "active" || war.sides[0].is_empty() || war.sides[1].is_empty() {
        return Ok(());
    }
    adopt_standing(run, &war);
    let war = war_of(run, id).unwrap();
    land_where_troops_stand(run, &war, day)?;
    let war = war_of(run, id).unwrap();
    let key = contact_key(run, &war);
    if !key.is_empty() && kept(run, &key) {
        return Ok(());
    }
    let Some(regions) = land_regions_of(run) else { return Err(RegionsNeeded) };
    let input = run.input.clone();
    let map = input.get("map");
    let contacts = find_contacts(&regions, |region| side_or_none(war_side_of(run, &war, region)), &map);
    for contact in contacts {
        if run.battles.iter().any(|battle| is_of_war(battle, &war.id) && battle.status != "closed" && point_in_frame(&battle.frame, contact.lng, contact.lat)) {
            continue;
        }
        if open_battles(run) as f64 >= MAX_BATTLEFIELDS {
            let detail = if war.title.is_empty() { war.id.clone() } else { war.title.clone() };
            run.notes.push(Val::obj([("kind", text("too-many-battlefields")), ("detail", text(&detail))]));
            break;
        }
        let Some(frame) = frame_for_contact(contact.bounds, &map) else { continue };
        let Some(arena) = arena_at(run, &frame) else { continue };
        let Some(mut battle) = open_battle(run, Opened { name: String::new(), war_id: text(&war.id), sides: war.sides.clone(), frame, arena, day, home: false }) else { continue };
        battle.name = name_for(run, &mut battle);
        battle.auto_named = true;
        start_battle(run, battle, day, None);
    }
    let after = contact_key(run, &war);
    if !after.is_empty() {
        keep(run, after);
    }
    Ok(())
}

fn own_cells(battle: &mut Battle, side: usize) -> Vec<i32> {
    let contour = trace_contour(battle.field.as_mut().unwrap());
    let own = if side == 0 { &contour.cell_a } else { &contour.cell_b };
    own.iter().copied().filter(|&cell| cell >= 0).collect()
}

fn home_cells(battle: &Battle, run: &Run, cells: Vec<i32>, wanted: &str) -> Vec<i32> {
    let home: Vec<i32> = cells
        .iter()
        .copied()
        .filter(|&cell| {
            let region = battle.arena.region[cell as usize] as usize;
            region > 0 && fold_text(&holder_of(battle, run, &battle.arena.ids[region])) == wanted
        })
        .collect();
    if home.is_empty() {
        cells
    } else {
        home
    }
}

fn has_deploy_line(battle: &Battle, side: usize, member: &str) -> bool {
    let wanted = fold_text(member);
    battle.deploy.as_ref().is_some_and(|lines| lines[side].iter().any(|entry| fold_text(&entry.country) == wanted && !entry.swarm))
}

fn deploy_on(battle: &Battle, side: usize, member: &str, cells: Vec<i32>) -> Vec<i32> {
    let Some(lines) = battle.deploy.as_ref() else { return cells };
    let field = battle.field.as_ref().unwrap();
    deploy_cells(&lines[side], member, &field.holders, field.cols, field.rows, battle.frame.km, &battle.place, side as u8, cells)
}

fn first_held(field: &Field, side: usize) -> Option<i32> {
    field.holders.iter().position(|&holder| holder as usize == side).map(|at| at as i32)
}

fn cell_at(cells: &[i32], index: usize, count: usize) -> i32 {
    let at = ((index as f64 + 0.5) * cells.len() as f64 / count as f64).floor() as usize;
    cells[at.min(cells.len() - 1)]
}

fn raise_for(run: &Run, battle: &mut Battle, side: usize, owner: usize) {
    let member = battle.sides[side][owner].clone();
    let military = run.mech.military();
    if military && land_worth(&run.military_of(&member)) == 0.0 {
        return;
    }
    let wanted = jsmath::round(TROOPS_PER_STRENGTH * run.troops * member_weights(battle, run, None, side)[owner] * effort_factor(&battle.effort[side]));
    let room = jsmath::min(MAX_TROOPS_PER_SIDE - battle.troops[side].len() as f64, troops_cap(battle.line_km, run.troops) - live_count(&battle.troops[side]) as f64);
    let whole = formations_left_with(run, &member, None, Some(&*battle));
    let part = if military { part_left_with(run, &member, None, Some(&*battle)) } else { 0.0 };
    let count = jsmath::max(0.0, jsmath::min(jsmath::min(room, jsmath::max(2.0, wanted)), whole + if part > 0.0 { 1.0 } else { 0.0 }));
    let cells = own_cells(battle, side);
    let cells = home_cells(battle, run, cells, &fold_text(&member));
    let cells = deploy_on(battle, side, &member, cells);
    if cells.is_empty() {
        return;
    }
    let count = count as usize;
    let kinds = if military { Some(kinds_for(count, run.era, mix_of(&run.military_of(&member)))) } else { None };
    let mut men = 0.0;
    let first = battle.troops[side].len();
    let cols = battle.field.as_ref().unwrap().cols as i32;
    for index in 0..count {
        let cell = cell_at(&cells, index, count);
        let strength = if military && index == count - 1 && count as f64 > whole { jsmath::round(100.0 * part) } else { 100.0 };
        let mut seed = TroopSeed { x: (cell % cols) as f64 + 0.5, y: (cell / cols) as f64 + 0.5, owner: owner as f64, strength, ..TroopSeed::default() };
        if let Some(kinds) = &kinds {
            seed.kind = kinds[index];
        }
        battle.troops[side].push(create_troop(seed));
        men += (strength / 100.0) * men_of(run, &member);
    }
    draw(run, &member, if military { men } else { count as f64 * run.men_each });
    battle.pool[side] += count as f64 * POOL_PER_TROOP * battle.edge[side].reserves;
    gather_newcomers(battle, side, owner as f64, first, &text(&run.warfare));
    let war = run.wars.get(&war_id_of(battle)).cloned();
    if marches_for(run, battle, war.as_ref()) {
        let fresh: Vec<usize> = (first..battle.troops[side].len()).collect();
        send_inland(battle, run, side, &fresh);
    }
}

fn put_under_standing(run: &Run, battle: &mut Battle, side: usize, first: usize, today: &Today, day: f64) {
    let standing: Vec<Val> = battle
        .orders
        .iter()
        .filter(|order| order.read("s").num() == side as f64 && !order.read("chosen").truthy() && !word_is(&order.read("order"), "assault") && !word_is(&order.read("order"), "withdraw"))
        .cloned()
        .collect();
    let mut under: Vec<(Val, Vec<usize>)> = Vec::new();
    for at in first..battle.troops[side].len() {
        let (x, y) = (battle.troops[side][at].x, battle.troops[side][at].y);
        let fits = |order: &Val| match resolve_sector(&battle.arena, &today.line.contour, today.line.count(), &today.sectors, &order.read("sector")) {
            Some(stretch) => !matches!(stretch, Sector::All) && in_sector(&stretch, x, y, |row| battle.place.km_at(row)),
            None => false,
        };
        let order = standing.iter().find(|order| fits(order)).or_else(|| standing.iter().find(|order| fold(&order.read("sector")) == "all"));
        if let Some(order) = order {
            match under.iter_mut().find(|(known, _)| known.same_ref(order)) {
                Some((_, picked)) => picked.push(at),
                None => under.push((order.clone(), vec![at])),
            }
        }
    }
    let date = run.date_of(day);
    for (order, picked) in under {
        let mut order = order;
        assign_order(battle, run, &mut order, &order_day(today, &date), Some(&picked), true);
    }
}

fn muster_day(run: &mut Run, at: usize, day: f64) {
    if !run.mech.muster() || !levy_owed(&run.battles[at].levy) {
        return;
    }
    let mut battle = lend(run, at);
    let mut today: Option<Today> = None;
    for side in 0..2 {
        for entry_at in 0..battle.levy[side].len() {
            let entry = battle.levy[side][entry_at].clone();
            let owner = entry.o as usize;
            let Some(member) = battle.sides[side].get(owner).cloned() else { continue };
            if entry.r >= entry.t || battle.gone[side].contains(&owner) {
                continue;
            }
            let days = diff_game_days(&entry.f, &run.date_of(day));
            let share = match days {
                None => 1.0,
                Some(days) => {
                    let curve = run.muster_of(&member);
                    muster_share(curve.get("table").as_array().map(|table| table.as_slice()), days)
                }
            };
            let military = run.mech.military();
            let whole = formations_left_with(run, &member, None, Some(&battle));
            let part = if military { part_left_with(run, &member, None, Some(&battle)) } else { 0.0 };
            let due = jsmath::min(jsmath::min(jsmath::min(entry.t, (entry.t * share).floor()) - entry.r, MAX_TROOPS_PER_SIDE - battle.troops[side].len() as f64), whole + if part > 0.0 { 1.0 } else { 0.0 });
            if !(due > 0.0) {
                continue;
            }
            let cells = own_cells(&mut battle, side);
            let mut cells = home_cells(&battle, run, cells, &fold_text(&member));
            if cells.is_empty() {
                if let Some(cell) = first_held(battle.field.as_ref().unwrap(), side) {
                    cells = vec![cell];
                }
            }
            if battle.home {
                let mine = own_ground_of(&battle, run, member.as_str());
                let field = battle.field.as_ref().unwrap();
                let arena = battle.arena.clone();
                cells = cells_round_cities(&battle, side, &|cell| field.holders[cell] as usize == side && field.play[cell] == 1 && mine[arena.region[cell] as usize] == 1, due);
            }
            let cells = deploy_on(&battle, side, &member, cells);
            if cells.is_empty() {
                continue;
            }
            if today.is_none() {
                today = Some(prepare(&mut battle, day));
            }
            let due = due as usize;
            let all = kinds_for(entry.t as usize, run.era, if military { mix_of(&run.military_of(&member)) } else { None });
            let kinds: Vec<f64> = all.iter().skip(entry.r as usize).take(due).copied().collect();
            let first = battle.troops[side].len();
            let cols = battle.field.as_ref().unwrap().cols as i32;
            let mut men = 0.0;
            for index in 0..due {
                let cell = cell_at(&cells, index, due);
                let strength = if military && index == due - 1 && due as f64 > whole { jsmath::round(100.0 * part) } else { 100.0 };
                let kind = kinds.get(index).copied().unwrap_or(f64::NAN);
                battle.troops[side].push(create_troop(TroopSeed { x: (cell % cols) as f64 + 0.5, y: (cell / cols) as f64 + 0.5, kind, owner: entry.o, strength, ..TroopSeed::default() }));
                men += (strength / 100.0) * men_of(run, &member);
            }
            draw(run, &member, men);
            battle.pool[side] += due as f64 * POOL_PER_TROOP * battle.edge[side].reserves;
            battle.levy[side][entry_at].r += due as f64;
            gather_newcomers(&mut battle, side, entry.o, first, &text(&run.warfare));
            if marches_for(run, &battle, None) {
                let fresh: Vec<usize> = (first..battle.troops[side].len()).collect();
                send_inland(&mut battle, run, side, &fresh);
            }
            put_under_standing(run, &mut battle, side, first, today.as_ref().unwrap(), day);
            battle.touched = true;
            battle.plan_key = String::new();
        }
    }
    for side in 0..2 {
        battle.levy[side].retain(|entry| entry.r < entry.t);
    }
    if today.is_some() {
        set_radii(&mut battle);
    }
    give(run, at, battle);
}

fn join_battle(run: &Run, battle: &mut Battle, side: usize, names: &[String]) {
    for name in names {
        let wanted = fold_text(name);
        let index = battle.sides[side].iter().position(|member| fold_text(member) == wanted);
        if let Some(index) = index {
            if !battle.gone[side].contains(&index) {
                continue;
            }
        }
        if side_of_name(battle, name) >= 0 {
            continue;
        }
        let owner = match index {
            Some(index) => {
                battle.gone[side].retain(|&gone| gone != index);
                index
            }
            None if (battle.sides[side].len() as f64) < MAX_SIDE_MEMBERS => {
                battle.sides[side].push(name.clone());
                battle.sides[side].len() - 1
            }
            None => continue,
        };
        reconcile(battle, run);
        line_length(battle);
        set_handicap(battle, run);
        raise_for(run, battle, side, owner);
        paint_ground(battle, run);
    }
    battle.plan_key = String::new();
}

fn leave_battle(run: &mut Run, battle: &mut Battle, names: &[String]) {
    for name in names {
        let wanted = fold_text(name);
        for side in 0..2 {
            let Some(index) = battle.sides[side].iter().enumerate().position(|(at, member)| fold_text(member) == wanted && !battle.gone[side].contains(&at)) else { continue };
            if !battle.gone[side].contains(&index) {
                battle.gone[side].push(index);
            }
            let theirs: Vec<usize> = battle.troops[side].iter().enumerate().filter(|(_, troop)| troop.owner == index as f64 && is_live(troop)).map(|(at, _)| at).collect();
            send_home(run, battle, side, Some(&theirs));
            for at in theirs {
                let troop = &battle.troops[side][at];
                if let Some(named) = battle.named.iter_mut().find(|entry| entry.s == side && entry.i == at) {
                    if !named.reported {
                        let [lng, lat] = battle.place.to_lng_lat(troop.x, troop.y);
                        run.unit_changes.push(Val::obj([("unitId", named.unit_id.clone()), ("committedTo", text("")), ("lng", num(lng)), ("lat", num(lat)), ("strength", num(jsmath::round(troop.strength)))]));
                        named.reported = true;
                    }
                }
                let troop = &mut battle.troops[side][at];
                troop.strength = 0.0;
                troop.station = None;
            }
            if battle.gone[side].len() >= battle.sides[side].len() {
                battle.closing = "left".to_string();
            }
        }
    }
    set_handicap(battle, run);
    reconcile(battle, run);
    battle.plan_key = String::new();
}

fn adopt_standing(run: &mut Run, war: &War) {
    for at in 0..run.battles.len() {
        if run.battles[at].status != "standing" || run.battles[at].home {
            continue;
        }
        let first = war_side(war, run.battles[at].sides[0].first().map_or("", |name| name.as_str()));
        let second = war_side(war, run.battles[at].sides[1].first().map_or("", |name| name.as_str()));
        if first < 0 || second < 0 || first == second {
            continue;
        }
        let mut battle = lend(run, at);
        battle.war_id = text(&war.id);
        battle.status = if war.status == "ceasefire" { "frozen".to_string() } else { "active".to_string() };
        battle.swap = first == 1;
        for order in battle.orders.iter_mut() {
            if word_is(&order.read("mark"), SCENARIO_MARK) {
                order.unset("mark");
            }
        }
        battle.begun = battle.status == "active";
        for side in 0..2 {
            if live_count(&battle.troops[side]) == 0 {
                raise_troops(&mut battle, run, None, side as i64);
            }
        }
        set_radii(&mut battle);
        paint_ground(&mut battle, run);
        battle.plan_key = String::new();
        battle.touched = true;
        give(run, at, battle);
    }
}

fn peace_day(run: &mut Run, at: usize, day: f64) {
    muster_day(run, at, day);
    let march = march_km_of(run);
    let date = run.date_of(day);
    let mut battle = lend(run, at);
    for side in 0..2 {
        let mut leaving: Vec<usize> = Vec::new();
        for index in 0..battle.troops[side].len() {
            if !is_live(&battle.troops[side][index]) {
                continue;
            }
            let kind = live_order(&battle.troops[side][index]).map(|order| order.read("kind")).unwrap_or(Val::Undef);
            if word_is(&kind, "withdraw") {
                leaving.push(index);
            } else if battle.troops[side][index].dug {
                battle.troops[side][index].goal = -1.0;
            } else if word_is(&kind, "way") {
                battle.troops[side][index].goal = -1.0;
                if walk_route(&mut battle, side, index, &march, day) {
                    battle.touched = true;
                }
            } else if battle.troops[side][index].goal >= 0.0 && march_on(&mut battle, side, index, &march) {
                battle.touched = true;
            }
        }
        if leaving.is_empty() {
            continue;
        }
        send_home(run, &battle, side, Some(&leaving));
        for &index in &leaving {
            battle.troops[side][index].strength = 0.0;
        }
        if live_count(&battle.troops[side]) == 0 {
            battle.levy[side] = Vec::new();
        }
        battle.log.push(Val::obj([("d", text(&date)), ("k", text("stood-down")), ("s", num(side as f64)), ("at", text(&format!("{} formations sent home", leaving.len()))), ("n", num(leaving.len() as f64))]));
        battle.touched = true;
    }
    give(run, at, battle);
}

fn stand_day(battle: &mut Battle) {
    battle.quiet += 1.0;
    let manned: Vec<usize> = (0..2).filter(|&side| live_count(&battle.troops[side]) > 0).collect();
    if battle.home {
        if manned.is_empty() && !levy_owed(&battle.levy) {
            battle.closing = "stood-down".to_string();
        }
        return;
    }
    if manned.is_empty() || (battle.quiet >= STANDING_QUIET_DAYS && manned.iter().all(|&side| battle.effort[side] == "token")) {
        battle.closing = "stood-down".to_string();
    }
}

fn sync_with_war(run: &mut Run, at: usize) {
    if run.battles[at].status == "standing" {
        let wars: Vec<War> = run.wars.values().filter(|war| war.status != "ended").cloned().collect();
        for war in wars {
            adopt_standing(run, &war);
        }
        if run.battles[at].status == "standing" {
            return;
        }
    }
    let war = war_of(run, &war_id_of(&run.battles[at])).filter(|_| matches!(run.battles[at].war_id, Val::Str(_)));
    let Some(war) = war.filter(|war| war.status != "ended") else {
        run.battles[at].closing = "war-over".to_string();
        return;
    };
    let mut battle = lend(run, at);
    battle.swap = war_side(&war, battle.sides[0].first().map_or("", |name| name.as_str())) == 1;
    for side in 0..2 {
        let theirs = war.sides[battle_side(&battle, side)].clone();
        let left: Vec<String> = battle.sides[side].iter().filter(|member| !theirs.iter().any(|name| fold_text(name) == fold_text(member))).cloned().collect();
        if !left.is_empty() {
            leave_battle(run, &mut battle, &left);
        }
        join_battle(run, &mut battle, side, &theirs);
    }
    battle.status = if war.status == "ceasefire" { "frozen".to_string() } else { "active".to_string() };
    give(run, at, battle);
}

fn war_between(run: &Run, a: &str, b: &str) -> Option<String> {
    run.wars.values().find(|war| war.status != "ended" && war_side(war, a) >= 0 && war_side(war, b) >= 0 && war_side(war, a) != war_side(war, b)).map(|war| war.id.clone())
}

fn slug_of(name: &str) -> String {
    let mut out = String::new();
    let mut gap = false;
    for unit in fold_text(name).chars() {
        if unit.is_alphabetic() || unit.is_numeric() {
            if gap {
                out.push('-');
            }
            gap = false;
            out.push(unit);
        } else {
            gap = true;
        }
    }
    let leading = fold_text(name).chars().next().is_some_and(|unit| !(unit.is_alphabetic() || unit.is_numeric()));
    if leading && out.starts_with('-') {
        out.remove(0);
    }
    out
}

fn attack_opens_war(run: &mut Run, attacker: &str, defender: &str, day: f64, serious: bool) -> Flow<Option<String>> {
    if clean_text(attacker, 120).is_empty() || clean_text(defender, 120).is_empty() || fold_text(attacker) == fold_text(defender) {
        return Ok(None);
    }
    if let Some(between) = war_between(run, attacker, defender) {
        return Ok(if run.wars.get(&between).unwrap().status == "active" { Some(between) } else { None });
    }
    let date = run.date_of(day);
    if run.wars.values().any(|war| war.status != "ended" && war_side(war, attacker) >= 0 && war_side(war, attacker) == war_side(war, defender)) {
        return Ok(None);
    }
    let names = |value: &Val, wanted: &str| member_list(value).iter().any(|name| fold_text(name) == fold_text(wanted));
    let told = run.moments.iter().enumerate().position(|(at, entry)| {
        let moment = &entry.moment;
        at as f64 >= run.cursor
            && word_is(moment.get("type"), "war")
            && word_is(moment.get("op"), "start")
            && ((names(moment.get("names"), attacker) && names(moment.get("opponents"), defender)) || (names(moment.get("opponents"), attacker) && names(moment.get("names"), defender)))
    });
    if let Some(told) = told {
        let moment = run.moments.remove(told).moment;
        apply_war_moment(run, &moment, day)?;
        let id = clean(moment.get("warId"), 120);
        return Ok(if run.wars.has(&id) { Some(id) } else { None });
    }
    if !serious {
        return Ok(None);
    }
    let id = format!("war-{}-{}-{}", slug_of(attacker), slug_of(defender), date);
    if let Some(war) = run.wars.get(&id) {
        return Ok(if war.status == "active" { Some(id) } else { None });
    }
    let (attacker, defender) = (clean_text(attacker, 120), clean_text(defender, 120));
    run.wars.set(id.clone(), War { id: id.clone(), title: String::new(), status: "active".to_string(), sides: [vec![attacker.clone()], vec![defender.clone()]], began: date.clone() });
    run.starts.push(Val::obj([("day", num(day)), ("date", text(&date)), ("warId", text(&id)), ("attacker", text(&attacker)), ("defender", text(&defender))]));
    examine_war(run, &id, day)?;
    Ok(Some(id))
}

fn serious_attack(run: &Run, moment: &Val) -> bool {
    moment.get("given").is_true() || word_in(moment.get("effort"), &WAR_EFFORTS) || players_have(run, moment.get("side"))
}

fn fronts_between(run: &Run, a: &str, b: &str) -> Vec<usize> {
    (0..run.battles.len())
        .filter(|&at| {
            let entry = &run.battles[at];
            entry.status == "active" && side_of_name(entry, a) >= 0 && side_of_name(entry, b) >= 0 && side_of_name(entry, a) != side_of_name(entry, b)
        })
        .collect()
}

fn kind_word(run: &Run, name: &str) -> &'static str {
    if run.is_group(name) {
        "group"
    } else {
        "country"
    }
}

fn tell_attack(run: &mut Run, at: usize, attacker: &str, defender: &str, day: f64) {
    let side = side_of_name(&run.battles[at], attacker);
    if side >= 0 {
        let entry = Val::obj([("d", text(&run.date_of(day))), ("k", text("attacked")), ("s", num(side as f64)), ("at", text(&format!("{}: {}", kind_word(run, defender), defender)))]);
        run.battles[at].log.push(entry);
    }
}

fn holder_side(run: &Run, id: &str, first: &str, second: &str) -> Option<usize> {
    let group = run.group_of(id);
    let holder = if group.is_empty() { run.controller_of(id) } else { group };
    if fold_text(&holder) == fold_text(first) {
        Some(0)
    } else if fold_text(&holder) == fold_text(second) {
        Some(1)
    } else {
        None
    }
}

fn lands_touch(run: &mut Run, first: &str, second: &str) -> Flow<bool> {
    let Some(regions) = land_regions_of(run) else { return Err(RegionsNeeded) };
    let input = run.input.clone();
    let map = input.get("map");
    Ok(!find_contacts(&regions, |id| holder_side(run, id, first, second), &map).is_empty())
}

fn with_ref(mut obj: Obj, moment: &Val) -> Val {
    if !moment.get("ref").is_undef() {
        obj.set("ref", moment.get("ref").clone());
    }
    Val::Obj(obj)
}

fn note_of(kind: &str, battlefield: &str, moment: &Val) -> Val {
    let mut obj = Obj::new();
    obj.set("kind", text(kind));
    obj.set("battlefield", text(battlefield));
    obj.set("side", text(&clean(moment.get("side"), 120)));
    with_ref(obj, moment)
}

fn with_battlefield(moment: &Val, name: &str) -> Val {
    let mut copy = js::spread(moment);
    copy.set("battlefield", text(name));
    Val::Obj(copy)
}

fn attack_at_objective(run: &mut Run, moment: &Val, day: f64) -> Flow<bool> {
    let attacker = clean(moment.get("side"), 120);
    let grid = world_grid_of(run)?;
    let Some(grid) = grid.filter(|_| !attacker.is_empty()) else { return Ok(false) };
    let alone = peace_of(&attacker, Vec::new());
    let objective_at = moment.get("objectiveAt");
    let at = if objective_at.truthy() && js::to_number(objective_at.get("lng")).is_finite() && js::to_number(objective_at.get("lat")).is_finite() {
        Some((js::to_number(objective_at.get("lng")), js::to_number(objective_at.get("lat"))))
    } else {
        place_named(run, &grid, &alone, moment.get("objective"))?.map(|(lng, lat, _)| (lng, lat))
    };
    let Some((lng, lat)) = at else { return Ok(false) };
    let defender = holder_at_point(run, &grid, &alone, lng, lat);
    if defender.is_empty() || fold_text(&defender) == fold_text(&attacker) {
        return Ok(false);
    }
    let already = war_between(run, &attacker, &defender);
    if already.is_none() && !word_is(moment.get("order"), "land") && !lands_touch(run, &attacker, &defender)? {
        return Ok(false);
    }
    let serious = serious_attack(run, moment);
    let war = match &already {
        Some(id) => Some(id.clone()),
        None => attack_opens_war(run, &attacker, &defender, day, serious)?,
    };
    if war.is_none() && already.is_none() && !serious {
        let mut note = Obj::new();
        note.set("kind", text("minor-attack"));
        note.set("battlefield", text(&clean(moment.get("battlefield"), BATTLEFIELD_NAME_MAX as usize)));
        note.set("side", text(&attacker));
        run.notes.push(with_ref(note, moment));
        return Ok(true);
    }
    let Some(war) = war.and_then(|id| war_of(run, &id)).filter(|war| war.status == "active") else { return Ok(false) };
    let fronts = fronts_between(run, &attacker, &defender);
    if fronts.is_empty() && word_is(moment.get("order"), "land") && (open_battles(run) as f64) < MAX_BATTLEFIELDS {
        let wanted = fold_battlefield_name(moment.get("battlefield"));
        let taken = run.battles.iter().any(|entry| entry.status != "closed" && fold_battlefield_name(&text(&entry.name)) == wanted);
        let name = if taken { Val::str("") } else { moment.get("battlefield").clone() };
        let Some(landing) = open_landing_at(run, &war, &attacker, lng, lat, &name, day, None)? else { return Ok(false) };
        if already.is_none() {
            tell_attack(run, landing, &attacker, &defender, day);
        }
        return Ok(true);
    }
    if fronts.is_empty() {
        return Ok(false);
    }
    let near = fronts.iter().copied().find(|&at| point_in_frame(&run.battles[at].frame, lng, lat)).unwrap_or(fronts[0]);
    let named = given_name(run, moment.get("battlefield"));
    if !named.is_empty() && run.battles[near].auto_named && run.battles[near].fresh && !run.battles.iter().enumerate().any(|(at, entry)| at != near && entry.status != "closed" && fold_battlefield_name(&text(&entry.name)) == fold_battlefield_name(&text(&named))) {
        run.battles[near].name = named;
        run.battles[near].auto_named = false;
    }
    if already.is_none() {
        for &front in &fronts {
            tell_attack(run, front, &attacker, &defender, day);
        }
    }
    let name = run.battles[near].name.clone();
    order_on_front(run, near, &with_battlefield(moment, &name), day)?;
    Ok(true)
}

fn named_kind(value: &Val, kinds: &[&str]) -> Option<(String, String)> {
    let full = value.string_or_empty();
    let body = full.trim_start_matches(js::is_js_whitespace);
    let colon = body.find(':')?;
    let kind = body[..colon].trim_end_matches(js::is_js_whitespace).to_lowercase();
    if !kinds.contains(&kind.as_str()) || body[..colon].trim_end_matches(js::is_js_whitespace).chars().any(js::is_js_whitespace) {
        return None;
    }
    let rest = body[colon + 1..].trim_start_matches(js::is_js_whitespace);
    if rest.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    Some((kind, rest.to_string()))
}

fn open_landing(run: &mut Run, moment: &Val, day: f64) -> Flow<Option<usize>> {
    let side = moment.get("side").clone();
    let war = run.wars.values().find(|entry| entry.status == "active" && entry.sides.iter().any(|members| members.iter().any(|member| fold_text(member) == fold(&side)))).cloned();
    let named = named_kind(moment.get("objective"), &["city", "region"]);
    let wanted = match &named {
        Some((_, rest)) => fold_text(rest),
        None => fold(moment.get("objective")),
    };
    let Some(war) = war else { return Ok(None) };
    if wanted.is_empty() || open_battles(run) as f64 >= MAX_BATTLEFIELDS {
        return Ok(None);
    }
    let Some(regions) = regions_of(run) else { return Err(RegionsNeeded) };
    let map = run.input.get("map");
    let kind = named.as_ref().map_or("", |(kind, _)| kind.as_str());
    let city = if kind == "region" { None } else { map.get("cities").array_or_empty().iter().find(|entry| fold(entry.get("name")) == wanted).cloned() };
    let region = if city.is_some() || kind == "city" { None } else { regions.iter().find(|entry| fold(entry.get("name")) == wanted).cloned() };
    let (lng, lat) = match (&city, &region) {
        (Some(city), _) => (js::to_number(city.get("lng")), js::to_number(city.get("lat"))),
        (None, Some(region)) => {
            let [lng, lat] = middle_of(region);
            (lng, lat)
        }
        _ => return Ok(None),
    };
    open_landing_at(run, &war, &side.string_or_empty(), lng, lat, moment.get("battlefield"), day, None)
}

fn landing_ground(run: &Run, name: &str, war_id: &str, sides: &[Vec<String>; 2], frame: &Frame, arena: Rc<Arena>, day: f64) -> Battle {
    let sides_val = Val::Arr(sides.iter().map(|members| Val::Arr(members.iter().map(|member| text(member)).collect())).collect());
    let mut record = Obj::new();
    record.set("name", text(name));
    record.set("warId", text(war_id));
    record.set("sides", sides_val);
    record.set("frame", super::record::frame_record(frame));
    record.set("openedDate", text(&run.date_of(day)));
    record.set("status", text("active"));
    record.set("field", Val::obj([("mask", text("")), ("band", text("")), ("key", text(&arena.key))]));
    record.set("troops", Val::Arr(vec![text(""), text("")]));
    record.set("named", Val::Arr(Vec::new()));
    record.set("pool", Val::nums(&[0.0, 0.0]));
    record.set("base", Val::nums(&[0.0, 0.0]));
    record.set("quality", Val::nums(&[1.0, 1.0]));
    record.set("effort", Val::Arr(vec![text("major"), text("major")]));
    record.set("orders", Val::Arr(Vec::new()));
    record.set("brief", Val::Obj(Obj::new()));
    record.set("log", Val::Arr(Vec::new()));
    let mut battle = load_battle(run, &Val::Obj(record), arena);
    battle.frame = frame.clone();
    battle.opened_day = num(day);
    battle.fresh = true;
    battle
}

fn nearest_held_cell(field: &Field, side: usize, x: f64, y: f64, reach: f64) -> i64 {
    let (cols, rows) = (field.cols as i64, field.rows as i64);
    let reach = reach as i64;
    let mut best = -1i64;
    let mut least = f64::INFINITY;
    for dy in -reach..=reach {
        let row = y.floor() as i64 + dy;
        if row < 0 || row >= rows {
            continue;
        }
        for dx in -reach..=reach {
            let col = x.floor() as i64 + dx;
            if col < 0 || col >= cols || field.holders[(row * cols + col) as usize] as usize != side {
                continue;
            }
            let far = (dx * dx + dy * dy) as f64;
            if far < least {
                least = far;
                best = row * cols + col;
            }
        }
    }
    best
}

#[allow(clippy::too_many_arguments)]
fn open_landing_at(run: &mut Run, war: &War, side_name: &str, lng: f64, lat: f64, name: &Val, day: f64, carried: Option<&Val>) -> Flow<Option<usize>> {
    let regions = land_regions_of(run);
    if open_battles(run) as f64 >= MAX_BATTLEFIELDS {
        return Ok(None);
    }
    let Some(regions) = regions else { return Err(RegionsNeeded) };
    let input = run.input.clone();
    let map = input.get("map");
    let contact = contact_at(&regions, |id| side_or_none(war_side_of(run, war, id)), &map, lng, lat);
    let Some(frame) = contact.and_then(|contact| frame_for_contact(contact.bounds, &map)) else { return Ok(None) };
    let Some(arena) = arena_at(run, &frame) else { return Ok(None) };
    let given = given_name(run, name);
    let opened = open_battle(run, Opened { name: given.clone(), war_id: text(&war.id), sides: war.sides.clone(), frame: frame.clone(), arena: arena.clone(), day, home: false });
    let mut battle = match opened {
        Some(battle) => battle,
        None => landing_ground(run, &given, &war.id, &war.sides, &frame, arena.clone(), day),
    };
    let side = side_of_name(&battle, side_name);
    let [mut x, mut y] = battle.place.to_cell(lng, lat);
    let (cols, rows) = (arena.cols as f64, arena.rows as f64);
    let mut cell: i64 = if x >= 0.0 && y >= 0.0 && x < cols && y < rows { (y.floor() * cols + x.floor()) as i64 } else { -1 };
    let holders_at = |battle: &Battle, cell: i64| battle.field.as_ref().unwrap().holders[cell as usize] as i64;
    if carried.is_some() && side >= 0 && cell >= 0 && holders_at(&battle, cell) != 1 - side {
        cell = nearest_held_cell(battle.field.as_ref().unwrap(), (1 - side) as usize, x, y, 4.0);
        if cell >= 0 {
            x = (cell % arena.cols as i64) as f64 + 0.5;
            y = (cell / arena.cols as i64) as f64 + 0.5;
        }
    }
    if side < 0 || cell < 0 || holders_at(&battle, cell) != 1 - side {
        return Ok(None);
    }
    let side = side as usize;
    let field = battle.field.as_mut().unwrap();
    take_capsule(field, side as u8, x, y, x, y, LANDING_CELLS, LANDING_CELLS, How::default());
    redistance(field);
    battle.anchors.push(Val::obj([("s", num(side as f64)), ("x", num(x)), ("y", num(y))]));
    if given.is_empty() {
        battle.name = name_for(run, &mut battle);
        battle.auto_named = true;
    }
    let landed = carried.map(|load| Landed { side, x, y, load: load.clone(), owner: jsmath::max(0.0, member_index(&battle, side, side_name) as f64) });
    Ok(Some(start_battle(run, battle, day, landed)))
}

fn stands_to_withdraw(battle: &Battle, side: usize) -> bool {
    battle.orders.iter().any(|order| order.read("s").num() == side as f64 && !order.read("chosen").truthy() && word_is(&order.read("order"), "withdraw"))
}

fn report_named(run: &mut Run, battle: &mut Battle, side: usize, at: usize, sent: bool) {
    let troop = &battle.troops[side][at];
    let [lng, lat] = battle.place.to_lng_lat(troop.x, troop.y);
    let strength = jsmath::round(troop.strength);
    if let Some(named) = battle.named.iter_mut().find(|entry| entry.s == side && entry.i == at) {
        if !named.reported {
            run.unit_changes.push(Val::obj([("unitId", named.unit_id.clone()), ("committedTo", text("")), ("lng", num(lng)), ("lat", num(lat)), ("strength", num(strength))]));
            named.reported = true;
            if sent {
                let id = named.unit_id.string_or_empty();
                battle.sent_home.set(id, num(side as f64));
            }
        }
    }
}

fn withdraw_who_left(run: &mut Run, at: usize, day: f64) {
    let mut battle = lend(run, at);
    for side in 0..2 {
        let mut left = 0;
        for index in 0..battle.troops[side].len() {
            let troop = &battle.troops[side][index];
            let order = if is_live(troop) && troop.order.truthy() && word_is(&troop.order.read("kind"), "withdraw") { Some(troop.order.clone()) } else { None };
            let Some(order) = order else { continue };
            if !(order.read("home").is_true() || order.read("gone").num() >= WITHDRAW_KM || day - order.read("since").num() >= WITHDRAW_DAYS_MOST) {
                continue;
            }
            report_named(run, &mut battle, side, index, true);
            send_home(run, &battle, side, Some(&[index]));
            let troop = &mut battle.troops[side][index];
            troop.strength = 0.0;
            troop.station = None;
            troop.order = Val::Null;
            left += 1;
        }
        if left == 0 {
            continue;
        }
        battle.touched = true;
        battle.plan_key = String::new();
        if live_count(&battle.troops[side]) > 0 {
            continue;
        }
        battle.away[side] = true;
        battle.pool[side] = 0.0;
        if !stands_to_withdraw(&battle, side) {
            set_standing_order(&mut battle, side, &Val::obj([("sector", text("all")), ("order", text("withdraw")), ("since", text(&run.date_of(day))), ("age", num(0.0))]));
        }
        battle.log.push(Val::obj([("d", text(&run.date_of(day))), ("k", text("withdrew")), ("s", num(side as f64)), ("at", text(""))]));
    }
    give(run, at, battle);
}

fn come_back(run: &mut Run, at: usize, day: f64) {
    let mut battle = lend(run, at);
    for side in 0..2 {
        if !battle.away[side] || stands_to_withdraw(&battle, side) {
            continue;
        }
        battle.away[side] = false;
        let ids: Vec<String> = battle.sent_home.keys().cloned().collect();
        for id in ids {
            if battle.sent_home.get(&id).is_some_and(|of| of.num() == side as f64) {
                battle.sent_home.remove(&id);
            }
        }
        if live_count(&battle.troops[side]) > 0 {
            continue;
        }
        raise_troops(&mut battle, run, None, side as i64);
        set_radii(&mut battle);
        paint_ground(&mut battle, run);
        battle.plan_key = String::new();
        battle.touched = true;
        if live_count(&battle.troops[side]) > 0 {
            battle.log.push(Val::obj([("d", text(&run.date_of(day))), ("k", text("returned")), ("s", num(side as f64)), ("at", text(""))]));
        }
    }
    give(run, at, battle);
}

fn sector_word(sector: &Sector) -> Option<&str> {
    match sector {
        Sector::All => None,
        Sector::Cut { word, .. } => Some(word),
        Sector::Place { word, .. } => Some(word),
    }
}

fn reinforce_on_front(run: &mut Run, at: usize, moment: &Val, day: f64) {
    let name = run.battles[at].name.clone();
    let side_text = moment.get("side").string_or_empty();
    let side = side_of_name(&run.battles[at], &side_text);
    if side < 0 {
        run.notes.push(note_of("side-not-fighting", &name, moment));
        return;
    }
    let side = side as usize;
    let played = players_have(run, moment.get("side"));
    if moment.get("unbound").is_true() && !moment.get("given").is_true() && !played {
        run.notes.push(note_of("reinforce-needs-event", &name, moment));
        return;
    }
    if run.battles[at].status != "active" && run.battles[at].status != "standing" {
        run.notes.push(note_of("reinforce-halted", &name, moment));
        return;
    }
    let battle = &run.battles[at];
    let owner = jsmath::max(0.0, member_index(battle, side, &side_text) as f64) as usize;
    let strength = sum_of(&member_weights(battle, run, Some(at), side));
    let usual = jsmath::max(troops_least(run.troops), jsmath::round(troops_wanted(strength, &battle.effort[side], run.troops)));
    let live = live_count(&battle.troops[side]) as f64;
    let deployed = moment.get("deployed").truthy();
    let room = jsmath::min(jsmath::min(MAX_TROOPS_PER_SIDE - battle.troops[side].len() as f64, if deployed { MAX_TROOPS_PER_SIDE } else { REINFORCED_SIZE_MOST * usual - live }), if battle.home { MAX_TROOPS_PER_SIDE } else { REINFORCED_LINE_MOST * troops_cap(battle.line_km, run.troops) - live });
    let military = run.mech.military();
    let drafted = battle.sides[side][owner].clone();
    let no_army = military && land_worth(&run.military_of(&drafted)) == 0.0;
    let full_counters = if no_army { 0.0 } else { formations_left(run, &drafted) };
    let last_part = if military && !no_army { part_left(run, &drafted) } else { 0.0 };
    let men = full_counters + if last_part > 0.0 { 1.0 } else { 0.0 };
    let said = js::to_number(moment.get("count"));
    let asked = if said.is_finite() && said >= 1.0 { jsmath::min(REINFORCE_MOST, jsmath::round(said)) } else { jsmath::max(2.0, jsmath::round(usual * REINFORCE_USUAL_SHARE)) };
    let count = jsmath::max(0.0, jsmath::min(jsmath::min(asked, room), men));
    if count == 0.0 || count.is_nan() {
        run.notes.push(note_of(if room > 0.0 && men <= 0.0 { "reinforce-no-men" } else { "reinforce-full" }, &name, moment));
        return;
    }
    let mut battle = lend(run, at);
    let today = prepare(&mut battle, day);
    let sector = resolve_sector(&battle.arena, &today.line.contour, today.line.count(), &today.sectors, moment.get("sector"));
    let whole = matches!(sector, None | Some(Sector::All));
    let cols = battle.field.as_ref().unwrap().cols as i32;
    let mut cells = own_cells(&mut battle, side);
    if !whole {
        let stretch = sector.as_ref().unwrap();
        let inside: Vec<i32> = cells.iter().copied().filter(|&cell| in_sector(stretch, (cell % cols) as f64 + 0.5, (cell / cols) as f64 + 0.5, |row| battle.place.km_at(row))).collect();
        if !inside.is_empty() {
            cells = inside;
        }
    }
    let wanted = fold_text(&battle.sides[side][owner]);
    let mut cells = home_cells(&battle, run, cells, &wanted);
    if cells.is_empty() {
        if let Some(cell) = first_held(battle.field.as_ref().unwrap(), side) {
            cells = vec![cell];
        }
    }
    if battle.home {
        let mine = own_ground_of(&battle, run, drafted.as_str());
        let field = battle.field.as_ref().unwrap();
        let arena = battle.arena.clone();
        cells = cells_round_cities(&battle, side, &|cell| field.holders[cell] as usize == side && field.play[cell] == 1 && mine[arena.region[cell] as usize] == 1, count);
    }
    let on_line = has_deploy_line(&battle, side, &drafted);
    let cells = deploy_on(&battle, side, &drafted, cells);
    if cells.is_empty() {
        give(run, at, battle);
        run.notes.push(note_of("reinforce-no-ground", &name, moment));
        return;
    }
    let count = count as usize;
    let first = battle.troops[side].len();
    let mut called = 0.0;
    let kinds = kinds_for(count, run.era, if military { mix_of(&run.military_of(&drafted)) } else { None });
    for (index, &kind) in kinds.iter().enumerate() {
        let cell = cell_at(&cells, index, count);
        let strength = if military && index == count - 1 && count as f64 > full_counters { jsmath::round(100.0 * last_part) } else { 100.0 };
        battle.troops[side].push(create_troop(TroopSeed { x: (cell % cols) as f64 + 0.5, y: (cell / cols) as f64 + 0.5, kind, owner: owner as f64, strength, ..TroopSeed::default() }));
        called += (strength / 100.0) * men_of(run, &drafted);
    }
    draw(run, &drafted, if military { called } else { count as f64 * run.men_each });
    battle.pool[side] += count as f64 * POOL_PER_TROOP * battle.edge[side].reserves;
    let swarmed = gather_newcomers(&mut battle, side, owner as f64, first, &text(&run.warfare));
    if marches_for(run, &battle, None) {
        let fresh: Vec<usize> = (first..battle.troops[side].len()).collect();
        send_inland(&mut battle, run, side, &fresh);
    }
    put_under_standing(run, &mut battle, side, first, &today, day);
    let at_home = battle.home;
    let away = battle.away[side];
    give(run, at, battle);
    if away {
        come_back(run, at, day);
    }
    let place = if deployed && swarmed > 0 {
        "where its swarm gathers".to_string()
    } else if deployed && on_line {
        "on its deployment line".to_string()
    } else if at_home {
        "round its cities".to_string()
    } else if whole {
        "along its whole line".to_string()
    } else {
        format!("in the {}", sector.as_ref().and_then(sector_word).map_or_else(|| clean(moment.get("sector"), 120), |word| word.to_string()))
    };
    let entry = Val::obj([("d", text(&run.date_of(day))), ("k", text("drafted")), ("s", num(side as f64)), ("at", text(&format!("{} fresh formations {}", count, place))), ("n", num(count as f64))]);
    let battle = &mut run.battles[at];
    battle.log.push(entry);
    battle.quiet = 0.0;
    battle.touched = true;
    battle.plan_key = String::new();
}

pub fn call_up_size(run: &Run, at: usize, side: usize, member: &str) -> f64 {
    let battle = &run.battles[at];
    let owner = jsmath::max(0.0, member_index(battle, side, member) as f64) as usize;
    let weights = member_weights(battle, run, Some(at), side);
    let usual = jsmath::max(troops_least(run.troops), jsmath::round(troops_wanted(weights.get(owner).copied().unwrap_or(0.0), &battle.effort[side], run.troops)));
    let days = jsmath::max(1.0, run.days);
    let curve = run.muster_of(member);
    let called = match curve.get("table") {
        Val::Arr(table) if !table.is_empty() => js::to_number(&table[jsmath::min(table.len() as f64 - 1.0, days) as usize]),
        _ => jsmath::min(1.0, days / CALL_UP_FULL_DAYS),
    };
    jsmath::max(1.0, (usual * called * (1.0 - run.shortage_of(member))).floor())
}

fn call_up_deployed(run: &mut Run) {
    for at in 0..run.battles.len() {
        if run.battles[at].status == "closed" || !run.battles[at].closing.is_empty() || run.battles[at].deploy.is_none() {
            continue;
        }
        for side in 0..2 {
            let mut entry_at = 0;
            while entry_at < run.battles[at].deploy.as_ref().map_or(0, |lines| lines[side].len()) {
                let entry = run.battles[at].deploy.as_ref().unwrap()[side][entry_at].clone();
                entry_at += 1;
                let Some(call) = &entry.call else { continue };
                let before = run.battles[at].troops[side].len();
                let noted = run.notes.len();
                let first_day = run.date_of(0.0);
                if run.battles[at].home && run.battles[at].called_on == first_day {
                    continue;
                }
                let mut moment = Obj::new();
                moment.set("side", text(&entry.country));
                moment.set("sector", text("all"));
                moment.set("given", Val::Bool(true));
                moment.set("deployed", Val::Bool(true));
                let count = match call {
                    Call::Count(count) if *count == 0.0 => 0.0,
                    _ => call_up_size(run, at, side, &entry.country),
                };
                moment.set("count", num(count));
                if run.battles[at].home {
                    run.battles[at].called_on = first_day;
                }
                reinforce_on_front(run, at, &Val::Obj(moment), 0.0);
                let n = run.battles[at].troops[side].len() as f64 - before as f64;
                let said: Vec<String> = run.notes[noted..].iter().map(|note| note.read("kind").string_or_empty()).filter(|kind| DEPLOY_WHY.iter().any(|(key, _)| key == kind)).collect();
                let why = if n > 0.0 { String::new() } else { said.last().and_then(|kind| DEPLOY_WHY.iter().find(|(key, _)| key == kind)).map_or(String::new(), |(_, word)| word.to_string()) };
                let mut spent = entry.clone();
                spent.call = None;
                spent.last = Some(Last { n, why, d: run.date_of(0.0) });
                if let Some(lines) = run.battles[at].deploy.as_mut() {
                    lines[side][entry_at - 1] = spent;
                }
            }
        }
    }
}

fn hold_objective(run: &mut Run, at: usize, objective: &Val, day: f64) -> Flow<bool> {
    let wanted = clean(objective, 120);
    {
        let battle = &run.battles[at];
        if wanted.is_empty() || battle.status == "closed" || battle.field.is_none() || find_place(&battle.arena, &text(&wanted)).is_some() {
            return Ok(false);
        }
    }
    let colon = wanted.find(':');
    let kind = colon.map_or(String::new(), |colon| fold_text(&wanted[..colon]));
    let name = fold_text(colon.map_or(wanted.as_str(), |colon| &wanted[colon + 1..]));
    if name.is_empty() || (!kind.is_empty() && kind != "city") {
        return Ok(false);
    }
    let Some(city) = run.input.get("map").get("cities").array_or_empty().iter().find(|entry| fold(entry.get("name")) == name).cloned() else { return Ok(false) };
    let (lng, lat) = (js::to_number(city.get("lng")), js::to_number(city.get("lat")));
    if !lng.is_finite() || !lat.is_finite() {
        return Ok(false);
    }
    let battle = &run.battles[at];
    let [x, y] = battle.place.to_cell(lng, lat);
    let beyond = jsmath::max(jsmath::max(jsmath::max(jsmath::max(0.0, -x), x - battle.frame.cols), -y), y - battle.frame.rows);
    if !(beyond * battle.frame.km <= OBJECTIVE_BEYOND_KM) {
        return Ok(false);
    }
    let mut battle = lend(run, at);
    let grown = grow_to_hold(&mut battle, run, day, lng, lat);
    give(run, at, battle);
    grown
}

fn order_on_front(run: &mut Run, at: usize, moment: &Val, day: f64) -> Flow<()> {
    if word_is(moment.get("order"), REINFORCE_ORDER) {
        reinforce_on_front(run, at, moment, day);
        return Ok(());
    }
    if moment.get("objective").truthy() {
        hold_objective(run, at, moment.get("objective"), day)?;
    }
    let ordered = side_of_name(&run.battles[at], &moment.get("side").string_or_empty());
    if run.battles[at].status == "active" && ordered >= 0 && run.battles[at].away[ordered as usize] && word_in(moment.get("order"), &FRONT_ORDERS) && !word_is(moment.get("order"), "withdraw") {
        run.battles[at].orders.retain(|order| !(order.read("s").num() == ordered as f64 && !order.read("chosen").truthy() && word_is(&order.read("order"), "withdraw")));
        come_back(run, at, day);
    }
    let mut battle = lend(run, at);
    let today = prepare(&mut battle, day);
    let date = run.date_of(day);
    let mut notes = std::mem::take(&mut run.notes);
    apply_order(&mut battle, run, moment, &order_day(&today, &date), &mut notes);
    run.notes = notes;
    battle.touched = true;
    let settles = battle.status == "active" && battle.city_holder.is_some();
    give(run, at, battle);
    if settles {
        settle(run, at, day);
    }
    Ok(())
}

fn find_open_named(run: &Run, names: &[String]) -> Option<usize> {
    run.battles.iter().position(|entry| entry.status != "closed" && names.iter().any(|name| fold_battlefield_name(&text(&entry.name)) == fold_battlefield_name(&text(name))))
}

fn apply_border_moment(run: &mut Run, moment: &Val, day: f64, first: &str, second: &str) -> Flow<()> {
    let label = clean(moment.get("battlefield"), BATTLEFIELD_NAME_MAX as usize);
    let names = [clean_text(&format!("{} / {} border", first, second), BATTLEFIELD_NAME_MAX as usize), clean_text(&format!("{} / {} border", second, first), BATTLEFIELD_NAME_MAX as usize)];
    let mut battle = find_open_named(run, &names);
    let peace = war_between(run, first, second).is_none();
    let side = fold(moment.get("side"));
    let other = if side == fold_text(first) {
        second.to_string()
    } else if side == fold_text(second) {
        first.to_string()
    } else {
        String::new()
    };
    let order = moment.get("order").clone();
    if peace && battle.is_none() && !other.is_empty() && fold_text(first) != fold_text(second) && is_attack_word(&order) && !word_is(&order, "land") {
        if !lands_touch(run, first, second)? {
            run.notes.push(note_of("border-not-found", &label, moment));
            return Ok(());
        }
        let serious = serious_attack(run, moment);
        let attacker = clean(moment.get("side"), 120);
        let war = attack_opens_war(run, &attacker, &other, day, serious)?;
        let fronts = if war.is_some() { fronts_between(run, first, second) } else { Vec::new() };
        if fronts.is_empty() {
            run.notes.push(note_of(if war.is_none() && !serious { "minor-attack" } else { "not-at-war" }, &label, moment));
            return Ok(());
        }
        for front in fronts {
            tell_attack(run, front, &attacker, &other, day);
            let name = run.battles[front].name.clone();
            order_on_front(run, front, &with_battlefield(moment, &name), day)?;
        }
        return Ok(());
    }
    if battle.is_none() {
        let fronts: Vec<usize> = (0..run.battles.len())
            .filter(|&at| {
                let entry = &run.battles[at];
                entry.status != "closed" && entry.status != "standing" && side_of_name(entry, first) >= 0 && side_of_name(entry, second) >= 0 && side_of_name(entry, first) != side_of_name(entry, second)
            })
            .collect();
        if !fronts.is_empty() {
            for front in fronts {
                let name = run.battles[front].name.clone();
                order_on_front(run, front, &with_battlefield(moment, &name), day)?;
            }
            return Ok(());
        }
        let at_war = run.wars.values().any(|war| war.status != "ended" && war_side(war, first) >= 0 && war_side(war, second) >= 0 && war_side(war, first) != war_side(war, second));
        if at_war || !word_in(&order, &["dig in", "hold"]) || fold_text(first) == fold_text(second) {
            run.notes.push(note_of(if at_war { "border-at-war" } else { "not-at-war" }, &label, moment));
            return Ok(());
        }
        if open_battles(run) as f64 >= MAX_BATTLEFIELDS {
            run.notes.push(note_of("too-many-battlefields", &label, moment));
            return Ok(());
        }
        let Some(regions) = land_regions_of(run) else { return Err(RegionsNeeded) };
        let input = run.input.clone();
        let map = input.get("map");
        let contacts = find_contacts(&regions, |id| holder_side(run, id, first, second), &map);
        let mut opened = None;
        for contact in contacts {
            let Some(frame) = frame_for_contact(contact.bounds, &map) else { continue };
            let Some(arena) = arena_at(run, &frame) else { continue };
            opened = open_battle(run, Opened { name: names[0].clone(), war_id: text(""), sides: [vec![first.to_string()], vec![second.to_string()]], frame, arena, day, home: false });
            if opened.is_some() {
                break;
            }
        }
        let Some(mut fresh) = opened else {
            run.notes.push(note_of("border-not-found", &label, moment));
            return Ok(());
        };
        fresh.status = "standing".to_string();
        set_radii(&mut fresh);
        paint_ground(&mut fresh, run);
        keep_start(&mut fresh);
        read_sieges(&mut fresh);
        find_pockets(&mut fresh);
        start_recorder(&mut fresh, run, day, None);
        run.battles.push(fresh);
        battle = Some(run.battles.len() - 1);
    }
    order_on_border(run, battle.unwrap(), moment, day)
}

fn order_on_border(run: &mut Run, at: usize, moment: &Val, day: f64) -> Flow<()> {
    let name = run.battles[at].name.clone();
    let side_text = moment.get("side").string_or_empty();
    let side = side_of_name(&run.battles[at], &side_text);
    if side < 0 {
        run.notes.push(note_of("side-not-fighting", &name, moment));
        return Ok(());
    }
    let side = side as usize;
    run.battles[at].quiet = 0.0;
    run.battles[at].touched = true;
    let order = moment.get("order").clone();
    if run.battles[at].status == "standing" && is_attack_word(&order) && !word_is(&order, "land") {
        let battle = &run.battles[at];
        let attacker = battle.sides[side].iter().find(|member| fold_text(member) == fold_text(&side_text)).or(battle.sides[side].first()).cloned().unwrap_or_default();
        let defender = battle.sides[1 - side].first().cloned().unwrap_or_default();
        let serious = serious_attack(run, moment);
        if attack_opens_war(run, &attacker, &defender, day, serious)?.is_some() && run.battles[at].status == "active" {
            tell_attack(run, at, &attacker, &defender, day);
        } else if run.battles[at].status == "standing" && !serious {
            run.notes.push(note_of("minor-attack", &name, moment));
            return Ok(());
        }
    }
    if run.battles[at].status == "standing" {
        if word_in(moment.get("effort"), &FRONT_EFFORTS) {
            run.battles[at].effort[side] = moment.get("effort").string_or_empty();
        }
        let goes = word_is(&order, "fall back") || word_is(&order, "withdraw");
        run.battles[at].leaving[side] = goes;
        let battle = &run.battles[at];
        if (0..2).all(|each| battle.leaving[each] || live_count(&battle.troops[each]) == 0) && goes {
            run.battles[at].closing = "stood-down".to_string();
            return Ok(());
        }
        if live_count(&run.battles[at].troops[side]) == 0 && word_in(&order, &["dig in", "hold"]) {
            let mut battle = lend(run, at);
            raise_troops(&mut battle, run, None, side as i64);
            set_radii(&mut battle);
            paint_ground(&mut battle, run);
            give(run, at, battle);
        }
    }
    let name = run.battles[at].name.clone();
    order_on_front(run, at, &with_battlefield(moment, &name), day)
}

fn border_names(value: &Val) -> Option<(String, String)> {
    let full = value.string_or_empty();
    let body = full.trim_start_matches(js::is_js_whitespace);
    if !body.get(..6).is_some_and(|head| head.eq_ignore_ascii_case("border")) {
        return None;
    }
    let rest = body[6..].trim_start_matches(js::is_js_whitespace);
    let rest = rest.strip_prefix(':')?;
    let rest = rest.trim_start_matches(js::is_js_whitespace);
    if rest.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    let slash = rest.char_indices().filter(|(_, unit)| *unit == '/').map(|(at, _)| at).find(|&at| {
        let left = rest[..at].trim_end_matches(js::is_js_whitespace);
        !left.is_empty()
    })?;
    let first = rest[..slash].trim_end_matches(js::is_js_whitespace);
    let second = rest[slash + 1..].trim_start_matches(js::is_js_whitespace).trim_end_matches(js::is_js_whitespace);
    if first.is_empty() || second.is_empty() {
        return None;
    }
    Some((first.to_string(), second.to_string()))
}

fn line_ends(unit: char) -> bool {
    matches!(unit, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

fn prefixed_name(value: &Val, word: &str) -> Option<String> {
    let full = if value.is_nullish() { String::new() } else { js::to_string(value) };
    let body = full.trim_start_matches(js::is_js_whitespace);
    let mut units = body.char_indices();
    for wanted in word.chars() {
        let (_, unit) = units.next()?;
        if !unit.eq_ignore_ascii_case(&wanted) {
            return None;
        }
    }
    let after = units.next().map_or(body.len(), |(at, _)| at);
    let rest = body[after..].trim_start_matches(js::is_js_whitespace);
    let rest = rest.strip_prefix(':')?;
    let trimmed = rest.trim_start_matches(js::is_js_whitespace);
    if !trimmed.is_empty() {
        let name = trimmed.trim_end_matches(js::is_js_whitespace);
        if name.contains(line_ends) {
            return None;
        }
        return Some(name.to_string());
    }
    rest.chars().rev().find(|unit| !line_ends(*unit)).map(|unit| unit.to_string())
}

fn home_forces_of(run: &Run, country: &str) -> Option<usize> {
    run.battles.iter().position(|battle| battle.home && battle.status != "closed" && battle.closing.is_empty() && fold_text(battle.sides[0].first().map_or("", |name| name.as_str())) == fold_text(country))
}

fn holder_at_cell(battle: &Battle, run: &Run, cell: i64) -> String {
    let region = if cell >= 0 { battle.arena.region[cell as usize] as usize } else { 0 };
    if region > 0 {
        clean_text(&holder_of(battle, run, &battle.arena.ids[region]), 120)
    } else {
        String::new()
    }
}

fn own_ground_of(battle: &Battle, run: &Run, member: &str) -> Vec<u8> {
    let arena = &battle.arena;
    let wanted = fold_text(member);
    let mut mine = vec![0u8; arena.ids.len()];
    for region in 1..arena.ids.len() {
        if fold_text(&holder_of(battle, run, &arena.ids[region])) == wanted {
            mine[region] = 1;
        }
    }
    mine
}

fn open_home(run: &mut Run, country: &str, day: f64) -> Flow<Option<usize>> {
    let Some(regions) = land_regions_of(run) else { return Err(RegionsNeeded) };
    let holder_of_id = |run: &Run, id: &str| {
        let group = run.group_of(id);
        if group.is_empty() {
            run.controller_of(id)
        } else {
            group
        }
    };
    let wanted = fold_text(country);
    let mine: Vec<Val> = regions.iter().filter(|region| fold_text(&holder_of_id(run, &js::to_string(region.get("id")))) == wanted).cloned().collect();
    let Some(bounds) = home_bounds(&mine) else { return Ok(None) };
    let input = run.input.clone();
    let map = input.get("map");
    let Some(frame) = create_frame(bounds, measure_of(map), HOME_MARGIN_KM) else { return Ok(None) };
    let Some(arena) = arena_at(run, &frame) else { return Ok(None) };
    let neighbours = home_neighbours(&arena, |id| holder_of_id(run, id), country);
    if neighbours.is_empty() {
        return Ok(None);
    }
    let Some(mut battle) = open_battle(run, Opened { name: home_name(country), war_id: text(""), sides: [vec![clean_text(country, 120)], neighbours], frame, arena, day, home: true }) else { return Ok(None) };
    battle.status = "standing".to_string();
    battle.effort = ["major".to_string(), "token".to_string()];
    set_radii(&mut battle);
    paint_ground(&mut battle, run);
    keep_start(&mut battle);
    read_sieges(&mut battle);
    find_pockets(&mut battle);
    start_recorder(&mut battle, run, day, None);
    run.battles.push(battle);
    Ok(Some(run.battles.len() - 1))
}

fn call_up_at_home(run: &mut Run, at: usize, moment: &Val, day: f64) {
    let date = run.date_of(day);
    let name = run.battles[at].name.clone();
    if run.battles[at].called_on == date {
        run.notes.push(note_of("called-today", &name, moment));
        return;
    }
    let (member, usual) = {
        let battle = &run.battles[at];
        let member = battle.sides[0].first().cloned().unwrap_or_default();
        let weights = member_weights(battle, run, Some(at), 0);
        (member, jsmath::max(troops_least(run.troops), jsmath::round(troops_wanted(weights.first().copied().unwrap_or(0.0), "major", run.troops))))
    };
    let most = jsmath::max(1.0, jsmath::round(usual * (1.0 - run.shortage_of(&member))));
    let said = js::to_number(moment.get("count"));
    let count = if said.is_finite() && said >= 1.0 { jsmath::min(jsmath::round(said), most) } else { most };
    let mustering = run.muster_of(&member).get("table").truthy();
    let now = if mustering { jsmath::max(1.0, (count * MUSTER_STANDING_SHARE).floor()) } else { count };
    let before = run.battles[at].troops[0].len();
    let mut asked = js::spread(moment);
    asked.set("battlefield", text(&name));
    asked.set("sector", text("all"));
    asked.set("given", Val::Bool(true));
    asked.set("deployed", Val::Bool(true));
    asked.set("count", num(now));
    reinforce_on_front(run, at, &Val::Obj(asked), day);
    let came = (run.battles[at].troops[0].len() - before) as f64;
    if mustering && came > 0.0 && count > came {
        run.battles[at].levy[0].push(Levy { o: 0.0, t: count, r: came, f: date.clone() });
    }
    run.battles[at].called_on = date;
}

fn station_on_border(run: &mut Run, at: usize, target: &str, moment: &Val, day: f64) {
    let wanted = fold_text(target);
    let border = {
        let battle = &run.battles[at];
        let theirs: Vec<bool> = (0..battle.arena.ids.len()).map(|region| if region > 0 { fold_text(&clean_text(&holder_of(battle, run, &battle.arena.ids[region]), 120)) == wanted } else { wanted.is_empty() }).collect();
        let arena = battle.arena.clone();
        border_cells(battle, 0, &|cell| theirs[arena.region[cell] as usize])
    };
    let name = run.battles[at].name.clone();
    if border.is_empty() {
        run.notes.push(note_of("border-not-found", &name, moment));
        return;
    }
    let date = run.date_of(day);
    let battle = &mut run.battles[at];
    let cols = battle.field.as_ref().unwrap().cols as i32;
    let every = jsmath::max(1.0, (border.len() as f64 / 64.0).floor()) as usize;
    let nearest = |x: f64, y: f64| {
        let mut best = f64::INFINITY;
        let mut index = 0;
        while index < border.len() {
            let dx = (border[index] % cols) as f64 + 0.5 - x;
            let dy = (border[index] / cols) as f64 + 0.5 - y;
            if dx * dx + dy * dy < best {
                best = dx * dx + dy * dy;
            }
            index += every;
        }
        best
    };
    let troops = &mut battle.troops[0];
    let mut live: Vec<(usize, f64)> = troops.iter().enumerate().map(|(index, troop)| (index, if is_live(troop) { nearest(troop.x, troop.y) } else { f64::INFINITY })).filter(|entry| entry.1 < f64::INFINITY).collect();
    js::stable_sort_by(&mut live, |a, b| {
        let by = a.1 - b.1;
        if by != 0.0 && !by.is_nan() {
            by
        } else {
            a.0 as f64 - b.0 as f64
        }
    });
    let count = if word_in(moment.get("effort"), &WAR_EFFORTS) { live.len() } else { (live.len() as f64 / 2.0).ceil() as usize };
    let mut going: Vec<usize> = live.iter().take(count).map(|entry| entry.0).collect();
    js::stable_sort_by(&mut going, |&a, &b| {
        let by = troops[a].y - troops[b].y;
        if by != 0.0 && !by.is_nan() {
            return by;
        }
        let by = troops[a].x - troops[b].x;
        if by != 0.0 && !by.is_nan() {
            return by;
        }
        a as f64 - b as f64
    });
    let length = going.len();
    for (index, &at_troop) in going.iter().enumerate() {
        let troop = &mut troops[at_troop];
        let pick = jsmath::min(border.len() as f64 - 1.0, (((index as f64 + 0.5) * border.len() as f64) / length as f64).floor()) as usize;
        troop.goal = border[pick] as f64;
        troop.dug = false;
        if troop.order.truthy() && !troop.order.read("done").truthy() {
            troop.order.write("done", Val::Bool(true));
        }
    }
    if length > 0 {
        battle.log.push(Val::obj([("d", text(&date)), ("k", text("stationed")), ("s", num(0.0)), ("at", text(&format!("{} formations to the border with {}", length, target))), ("n", num(length as f64))]));
    }
}

fn stand_down_at_home(run: &mut Run, at: usize, day: f64) {
    let date = run.date_of(day);
    let mut battle = lend(run, at);
    send_home(run, &battle, 0, None);
    for troop in battle.troops[0].iter_mut() {
        troop.strength = 0.0;
    }
    battle.levy[0] = Vec::new();
    battle.log.push(Val::obj([("d", text(&date)), ("k", text("stood-down")), ("s", num(0.0)), ("at", text("all its forces at home sent home"))]));
    battle.closing = "stood-down".to_string();
    give(run, at, battle);
}

fn apply_home_moment(run: &mut Run, moment: &Val, day: f64, country: &str) -> Flow<()> {
    let label = home_name(country);
    if fold(moment.get("side")) != fold_text(country) {
        run.notes.push(note_of("side-not-fighting", &label, moment));
        return Ok(());
    }
    let mut battle = home_forces_of(run, country);
    if word_is(moment.get("order"), "withdraw") || word_is(moment.get("order"), "fall back") {
        if let Some(at) = battle {
            stand_down_at_home(run, at, day);
        }
        return Ok(());
    }
    if battle.is_none() {
        if run.battles.iter().filter(|entry| entry.home && entry.status != "closed").count() as f64 >= MAX_HOME_FORCES {
            run.notes.push(note_of("too-many-battlefields", &label, moment));
            return Ok(());
        }
        battle = open_home(run, country, day)?;
        if battle.is_none() {
            run.notes.push(note_of("home-not-found", &label, moment));
            return Ok(());
        }
    }
    let at = battle.unwrap();
    run.battles[at].quiet = 0.0;
    run.battles[at].touched = true;
    if word_is(moment.get("order"), REINFORCE_ORDER) {
        call_up_at_home(run, at, moment, day);
        return Ok(());
    }
    let holding = word_in(moment.get("order"), &["hold", "dig in"]);
    if let Some(target) = prefixed_name(moment.get("objective"), "country") {
        if holding {
            station_on_border(run, at, &clean_text(&target, 120), moment, day);
            return Ok(());
        }
    }
    if holding {
        let name = run.battles[at].name.clone();
        order_on_front(run, at, &with_battlefield(moment, &name), day)?;
    } else {
        run.notes.push(note_of("home-no-front", &label, moment));
    }
    Ok(())
}

fn attack_from_standing(run: &mut Run, at: usize) -> Flow<()> {
    if run.battles[at].status != "standing" || !run.battles[at].closing.is_empty() {
        return Ok(());
    }
    let orders = run.battles[at].orders.clone();
    for order in orders {
        let side = match order.read("s") {
            Val::Num(n) if n == 0.0 || n == 1.0 => n as usize,
            _ => continue,
        };
        if !order.read("chosen").truthy() {
            continue;
        }
        let (attacker, defender) = {
            let battle = &run.battles[at];
            let by = fold(&order.read("by"));
            let attacker = battle.sides[side].iter().find(|member| fold_text(member) == by).or(battle.sides[side].first()).cloned().unwrap_or_default();
            let way = order.read("way");
            let defender = match &way {
                Val::Arr(points) if !points.is_empty() => {
                    let (mut x, mut y, mut count) = (0.0, 0.0, 0.0);
                    for troop in &battle.troops[side] {
                        if !is_live(troop) || !(troop.order.truthy() && !troop.order.read("done").truthy() && troop.order.read("standing").same_ref(&order)) {
                            continue;
                        }
                        x += troop.x;
                        y += troop.y;
                        count += 1.0;
                    }
                    let route: Vec<[f64; 2]> = points.iter().map(|point| battle.place.to_cell(point.at(0).num(), point.at(1).num())).collect();
                    let path: Vec<[f64; 2]> = if count > 0.0 { std::iter::once([x / count, y / count]).chain(route).collect() } else { route };
                    way_into(battle, side, &path, &|cell| holder_at_cell(battle, run, cell as i64))
                }
                _ if !battle.home && is_attack_word(&order.read("order")) => battle.sides[1 - side].first().cloned().unwrap_or_default(),
                _ => String::new(),
            };
            (attacker, defender)
        };
        if defender.is_empty() || fold_text(&defender) == fold_text(&attacker) {
            continue;
        }
        let Some(war) = attack_opens_war(run, &attacker, &defender, 0.0, true)? else { continue };
        for front in 0..run.battles.len() {
            if is_of_war(&run.battles[front], &war) && run.battles[front].status == "active" {
                tell_attack(run, front, &attacker, &defender, 0.0);
            }
        }
        if run.battles[at].status != "standing" {
            return Ok(());
        }
    }
    Ok(())
}

struct Handed {
    order: Val,
    picked: Vec<usize>,
}

fn bring_home(run: &mut Run, battle: &mut Battle, day: f64) -> Vec<Handed> {
    let mut handed: Vec<Handed> = Vec::new();
    if battle.status != "active" || battle.home {
        return handed;
    }
    let date = run.date_of(day);
    for home_at in 0..run.battles.len() {
        {
            let home = &run.battles[home_at];
            if !home.home || home.status == "closed" || !home.closing.is_empty() {
                continue;
            }
        }
        let country = run.battles[home_at].sides[0].first().cloned().unwrap_or_default();
        let side = side_of_name(battle, &country);
        if side < 0 {
            continue;
        }
        let side = side as usize;
        let owner = jsmath::max(0.0, member_index(battle, side, &country) as f64);
        measure(battle.field.as_ref().unwrap(), &mut battle.to_side);
        let mut moved: Vec<(usize, Val)> = Vec::new();
        let home = &mut run.battles[home_at];
        for index in 0..home.troops[0].len() {
            if !is_live(&home.troops[0][index]) || battle.troops[side].len() as f64 >= MAX_TROOPS_PER_SIDE {
                continue;
            }
            let troop = &home.troops[0][index];
            let [lng, lat] = home.place.to_lng_lat(troop.x, troop.y);
            let [x, y] = battle.place.to_cell(lng, lat);
            let field = battle.field.as_ref().unwrap();
            let cell = field_cell_at(field, x, y);
            let to_other = &battle.to_side.as_ref().unwrap().sides[1 - side];
            if cell < 0 || field.holders[cell as usize] as usize != side || (to_other[cell as usize] as f64 / 3.0) * battle.frame.km > HOME_JOIN_KM {
                continue;
            }
            let mut joined = create_troop(TroopSeed { x, y, kind: troop.kind, owner, strength: troop.strength, ..TroopSeed::default() });
            if troop.fatigue > 0.0 {
                joined.fatigue = troop.fatigue;
            }
            let standing = if troop.order.truthy() && !troop.order.read("done").truthy() {
                match troop.order.read("standing") {
                    Val::Undef => Val::Null,
                    other => other,
                }
            } else {
                Val::Null
            };
            battle.troops[side].push(joined);
            moved.push((battle.troops[side].len() - 1, standing));
            home.troops[0][index].strength = 0.0;
        }
        if moved.is_empty() {
            continue;
        }
        for order in &home.orders {
            if !order.read("chosen").truthy() {
                continue;
            }
            let picked: Vec<usize> = moved.iter().filter(|(_, standing)| standing.same_ref(order)).map(|(index, _)| *index).collect();
            if picked.is_empty() {
                continue;
            }
            let mut entry = Obj::new();
            entry.set("s", num(side as f64));
            entry.set("sector", text("all"));
            entry.set("order", order.read("order"));
            entry.set("since", text(&date));
            entry.set("chosen", Val::Bool(true));
            for key in ["way", "by", "effort"] {
                let value = order.read(key);
                if value.truthy() {
                    entry.set(key, value);
                }
            }
            handed.push(Handed { order: Val::shared(entry), picked });
        }
        home.touched = true;
        home.plan_key = String::new();
        battle.log.push(Val::obj([("d", text(&date)), ("k", text("drafted")), ("s", num(side as f64)), ("at", text(&format!("{} formations from {}'s forces at home", moved.len(), country))), ("n", num(moved.len() as f64))]));
        battle.touched = true;
        battle.plan_key = String::new();
    }
    handed
}

fn home_orders(run: &mut Run, at: usize, handed: Vec<Handed>, day: f64) {
    if handed.is_empty() {
        return;
    }
    let mut battle = lend(run, at);
    let today = prepare(&mut battle, day);
    let date = run.date_of(day);
    for Handed { order, picked } in handed {
        battle.orders.push(order.clone());
        let mut order = order;
        assign_order(&mut battle, run, &mut order, &order_day(&today, &date), Some(&picked), true);
    }
    give(run, at, battle);
    mark_attacks(run, at);
}

fn apply_order_moment(run: &mut Run, moment: &Val, day: f64) -> Flow<()> {
    if word_is(moment.get("result"), "captured") && !run.captures_refused.is_empty() {
        let reference = clean(moment.get("ref"), 120);
        if run.captures_refused.iter().any(|key| reference.ends_with(key.as_str())) {
            return Ok(());
        }
    }
    if let Some((first, second)) = border_names(moment.get("battlefield")) {
        return apply_border_moment(run, moment, day, &clean_text(&first, 120), &clean_text(&second, 120));
    }
    if let Some(country) = prefixed_name(moment.get("battlefield"), "home") {
        return apply_home_moment(run, moment, day, &clean_text(&country, 120));
    }
    let mut moment = moment.clone();
    let wanted = fold_battlefield_name(moment.get("battlefield"));
    let side_text = moment.get("side").string_or_empty();
    let mut battle = if wanted.is_empty() { None } else { run.battles.iter().position(|entry| entry.status != "closed" && fold_battlefield_name(&text(&entry.name)) == wanted) };
    if battle.is_none() && !wanted.is_empty() && given_name(run, moment.get("battlefield")).is_empty() {
        battle = run.battles.iter().position(|entry| entry.status != "closed" && fold(&entry.war_id) == wanted && side_of_name(entry, &side_text) >= 0);
        if let Some(at) = battle {
            moment = with_battlefield(&moment, &run.battles[at].name.clone());
        }
    }
    if battle.is_none() && !wanted.is_empty() {
        battle = run.battles.iter().position(|entry| entry.auto_named && entry.fresh && entry.status == "active" && side_of_name(entry, &side_text) >= 0);
        let named = given_name(run, moment.get("battlefield"));
        if let Some(at) = battle {
            if !named.is_empty() {
                run.battles[at].name = named;
                run.battles[at].auto_named = false;
            }
            moment = with_battlefield(&moment, &run.battles[at].name.clone());
        }
    }
    if battle.is_none() && !wanted.is_empty() && word_is(moment.get("order"), "land") && open_landing(run, &moment, day)?.is_some() {
        return Ok(());
    }
    if battle.is_none() && !wanted.is_empty() && is_attack_word(moment.get("order")) && !clean(moment.get("objective"), 120).is_empty() && attack_at_objective(run, &moment, day)? {
        return Ok(());
    }
    let Some(at) = battle else {
        let mut note = Obj::new();
        note.set("kind", text("unknown-battlefield"));
        note.set("battlefield", text(&clean(moment.get("battlefield"), BATTLEFIELD_NAME_MAX as usize)));
        note.set("side", text(&clean(moment.get("side"), 120)));
        run.notes.push(with_ref(note, &moment));
        return Ok(());
    };
    if run.battles[at].status == "standing" {
        order_on_border(run, at, &moment, day)
    } else {
        order_on_front(run, at, &moment, day)
    }
}

fn texts_of(value: &Val) -> Vec<String> {
    value.array_or_empty().iter().map(|entry| entry.string_or_empty()).collect()
}

fn apply_war_moment(run: &mut Run, moment: &Val, day: f64) -> Flow<()> {
    let id = clean(moment.get("warId"), 120);
    let mut names = member_list(moment.get("names"));
    let mine = |run: &Run| -> Vec<usize> { (0..run.battles.len()).filter(|&at| is_of_war(&run.battles[at], &id) && run.battles[at].status != "closed").collect() };
    let op = moment.get("op").string_or_empty();
    if op == "start" {
        if id.is_empty() || run.wars.has(&id) {
            return Ok(());
        }
        let date = run.date_of(day);
        run.wars.set(id.clone(), War { id: id.clone(), title: clean(moment.get("title"), 120), status: "active".to_string(), sides: [names, member_list(moment.get("opponents"))], began: date });
        return examine_war(run, &id, day);
    }
    let Some(war) = war_of(run, &id) else { return Ok(()) };
    if op == "join-a" || op == "join-b" {
        let side = if op == "join-a" { 0 } else { 1 };
        if !moment.get("sent").is_true() {
            let shipped = |run: &Run, name: &str| {
                run.transports.iter().any(|transport| {
                    transport.status == "moving" && transport.war_id == id && war_side(&war, &transport.owner) == 1 - side as i64 && transport.attacks.as_ref().is_some_and(|attacks| attacks.iter().any(|entry| fold_text(entry) == fold_text(name)))
                })
            };
            let awaited = |run: &Run, name: &str| {
                shipped(run, name)
                    || run.battles.iter().any(|battle| {
                        is_of_war(battle, &id)
                            && battle.status == "active"
                            && side_of_name(battle, name) < 0
                            && battle.orders.iter().any(|order| order.read("chosen").truthy() && battle_side(battle, side) as f64 != order.read("s").num() && texts_of(&order.read("attacks")).iter().any(|entry| fold_text(entry) == fold_text(name)))
                    })
            };
            let mut index = names.len();
            while index > 0 {
                index -= 1;
                if awaited(run, &names[index]) {
                    names.remove(index);
                }
            }
            if names.is_empty() {
                return Ok(());
            }
        }
        {
            let war = run.wars.get_mut(&id).unwrap();
            for name in &names {
                if !war.sides.iter().any(|members| members.iter().any(|member| fold_text(member) == fold_text(name))) && (war.sides[side].len() as f64) < MAX_SIDE_MEMBERS {
                    war.sides[side].push(name.clone());
                }
            }
        }
        for at in mine(run) {
            let mut battle = lend(run, at);
            let own = battle_side(&battle, side);
            join_battle(run, &mut battle, own, &names);
            battle.touched = true;
            give(run, at, battle);
        }
        examine_war(run, &id, day)?;
    } else if op == "leave" {
        {
            let war = run.wars.get_mut(&id).unwrap();
            for members in war.sides.iter_mut() {
                members.retain(|member| !names.iter().any(|name| fold_text(name) == fold_text(member)));
            }
        }
        for at in mine(run) {
            let mut battle = lend(run, at);
            leave_battle(run, &mut battle, &names);
            battle.touched = true;
            give(run, at, battle);
        }
    } else if op == "ceasefire" {
        run.wars.get_mut(&id).unwrap().status = "ceasefire".to_string();
        for at in mine(run) {
            run.battles[at].status = "frozen".to_string();
        }
    } else if op == "resume" {
        run.wars.get_mut(&id).unwrap().status = "active".to_string();
        for at in mine(run) {
            run.battles[at].status = "active".to_string();
        }
        examine_war(run, &id, day)?;
    } else if op == "end" {
        run.wars.get_mut(&id).unwrap().status = "ended".to_string();
        for at in mine(run) {
            run.battles[at].closing = "war-over".to_string();
        }
    }
    Ok(())
}

fn apply_reinforce(run: &mut Run, moment: &Val) {
    let kind = match moment.get("kind") {
        Val::Num(n) => {
            if *n >= 0.0 && n.fract() == 0.0 && (*n as usize) < TROOP_KINDS.len() {
                text(TROOP_KINDS[*n as usize])
            } else {
                Val::Undef
            }
        }
        other => text(&if other.is_nullish() { "infantry".to_string() } else { js::to_string(other) }),
    };
    let unit_id = clean(moment.get("unitId"), 120);
    let unit = Val::obj([("id", text(&unit_id)), ("name", text(&clean(moment.get("name"), 120))), ("type", kind.clone()), ("ownerCode", moment.get("owner").clone()), ("strength", moment.get("strength").clone()), ("lng", moment.get("lng").clone()), ("lat", moment.get("lat").clone())]);
    let owner = moment.get("owner").string_or_empty();
    let (lng, lat) = (js::to_number(moment.get("lng")), js::to_number(moment.get("lat")));
    for at in 0..run.battles.len() {
        {
            let battle = &run.battles[at];
            if battle.status != "active" || side_of_name(battle, &owner) < 0 || !point_in_frame(&battle.frame, lng, lat) {
                continue;
            }
        }
        if !unit_id.is_empty() {
            if run.taken.contains(&unit_id) {
                continue;
            }
            let mut battle = lend(run, at);
            let took = absorb_unit(&mut battle, run, at, &unit, true);
            give(run, at, battle);
            if !took {
                continue;
            }
            run.taken.push(unit_id.clone());
        } else {
            let battle = &mut run.battles[at];
            let side = side_of_name(battle, &owner) as usize;
            let kind_at = TROOP_KINDS.iter().position(|known| matches!(&kind, Val::Str(name) if name == known));
            let Some(kind_at) = kind_at.filter(|_| (battle.troops[side].len() as f64) < MAX_TROOPS_PER_SIDE) else { continue };
            let [x, y] = battle.place.to_cell(lng, lat);
            let wanted = fold_text(&owner);
            let member = battle.sides[side].iter().position(|member| fold_text(member) == wanted).map_or(-1.0, |at| at as f64);
            let given = js::to_number(moment.get("strength"));
            let strength = jsmath::min(100.0, jsmath::max(1.0, if given != 0.0 && !given.is_nan() { given } else { 100.0 }));
            battle.troops[side].push(create_troop(TroopSeed { x, y, strength, kind: kind_at as f64, owner: member, ..TroopSeed::default() }));
            battle.plan_key = String::new();
        }
        run.battles[at].touched = true;
        return;
    }
}

struct Takers {
    cells: Vec<usize>,
    area_km2: f64,
    inside: Vec<usize>,
    near: Vec<(usize, f64)>,
}

fn region_takers(battle: &Battle, side: i64, region: usize) -> Takers {
    let field = battle.field.as_ref().unwrap();
    let arena = &battle.arena;
    let cols = field.cols;
    let cells: Vec<usize> = (0..field.size).filter(|&index| field.play[index] != 0 && arena.region[index] as usize == region).collect();
    let km = battle.frame.km;
    let reach = STORY_TAKER_REACH_KM / km;
    let reach_squared = reach * reach;
    let mut inside = Vec::new();
    let mut near: Vec<(usize, f64)> = Vec::new();
    if side >= 0 {
        for (at, troop) in battle.troops[side as usize].iter().enumerate() {
            if !is_live(troop) {
                continue;
            }
            let cell = troop.y.floor() * cols as f64 + troop.x.floor();
            if cell >= 0.0 && cell < field.size as f64 && arena.region[cell as usize] as usize == region {
                inside.push(at);
                continue;
            }
            let mut closest = f64::INFINITY;
            for &cell in &cells {
                let dx = (cell % cols) as f64 + 0.5 - troop.x;
                let dy = (cell / cols) as f64 + 0.5 - troop.y;
                let far = dx * dx + dy * dy;
                if far < closest {
                    closest = far;
                }
            }
            if closest <= reach_squared {
                near.push((at, closest));
            }
        }
    }
    js::stable_sort_by(&mut near, |a, b| a.1 - b.1);
    Takers { area_km2: cells.len() as f64 * km * km, cells, inside, near }
}

fn capture_refused(run: &Run, region_id: &str, taker: &Val) -> Option<(String, String)> {
    for battle in &run.battles {
        let Some(&region) = battle.arena.index_of.get(region_id).filter(|_| battle.status == "active") else { continue };
        let side = side_of_name(battle, &taker.string_or_empty());
        if side < 0 {
            continue;
        }
        let takers = region_takers(battle, side, region);
        let holders = &battle.field.as_ref().unwrap().holders;
        if !takers.cells.iter().any(|&cell| holders[cell] as i64 == 1 - side) {
            continue;
        }
        if ((takers.inside.len() + takers.near.len()) as f64) < takers_for(takers.area_km2).least {
            let name = &battle.arena.names[region];
            return Some((battle.name.clone(), if name.is_empty() { region_id.to_string() } else { name.clone() }));
        }
    }
    None
}

fn march_into(run: &mut Run, at: usize, region: usize, taker: &Val, day: f64) {
    let side = side_of_name(&run.battles[at], &taker.string_or_empty());
    if side < 0 || region == 0 {
        return;
    }
    let side = side as usize;
    let date = run.date_of(day);
    let battle = &mut run.battles[at];
    let field = battle.field.as_ref().unwrap();
    let cols = field.cols;
    let cells: Vec<usize> = (0..field.size).filter(|&index| field.play[index] != 0 && battle.arena.region[index] as usize == region && field.holders[index] as usize == side).collect();
    if !cells.is_empty() {
        let takers = region_takers(battle, side as i64, region);
        let most = jsmath::max(0.0, takers_for(takers.area_km2).most - takers.inside.len() as f64) as usize;
        let nearest: Vec<usize> = takers.near.iter().take(most).map(|(at, _)| *at).collect();
        let mut used: Vec<usize> = Vec::new();
        for &index in &nearest {
            let troop = &battle.troops[side][index];
            let mut best: Option<usize> = None;
            let mut best_far = f64::INFINITY;
            for &cell in &cells {
                if used.contains(&cell) {
                    continue;
                }
                let dx = (cell % cols) as f64 + 0.5 - troop.x;
                let dy = (cell / cols) as f64 + 0.5 - troop.y;
                let far = dx * dx + dy * dy;
                if far < best_far {
                    best_far = far;
                    best = Some(cell);
                }
            }
            let Some(best) = best else { break };
            used.push(best);
            let troop = &mut battle.troops[side][index];
            troop.x = (best % cols) as f64 + 0.5;
            troop.y = (best / cols) as f64 + 0.5;
            troop.dig = 0.0;
        }
        if !nearest.is_empty() {
            let name = if battle.arena.names[region].is_empty() { battle.arena.ids[region].clone() } else { battle.arena.names[region].clone() };
            battle.log.push(Val::obj([("d", text(&date)), ("k", text("whole")), ("s", num(side as f64)), ("at", text(&format!("region: {}", name)))]));
        }
    }
    let reach = (battle.field.as_ref().unwrap().cols + battle.field.as_ref().unwrap().rows) as f64;
    give_way(battle, 1 - side, 0.0, &date, reach);
}

fn apply_moments(run: &mut Run, day: f64) -> Flow<()> {
    while (run.cursor as usize) < run.moments.len() && run.moments[run.cursor as usize].day <= day {
        let moment = run.moments[run.cursor as usize].moment.clone();
        run.cursor += 1.0;
        let kind = moment.get("type").string_or_empty();
        if kind == "order" {
            apply_order_moment(run, &moment, day)?;
        } else if kind == "war" {
            apply_war_moment(run, &moment, day)?;
        } else if kind == "reinforce" {
            apply_reinforce(run, &moment);
        } else if kind == "airstrike" {
            bomb_troops(run, &moment, day);
        } else if kind == "control" {
            let id = clean(moment.get("regionId"), 120);
            let refused = if moment.get("capture").is_true() { capture_refused(run, &id, moment.get("to")) } else { None };
            if let Some((battlefield, region)) = refused {
                let mut note = Obj::new();
                note.set("kind", text("capture-failed"));
                note.set("regionId", text(&id));
                note.set("region", text(&region));
                note.set("taker", text(&clean(moment.get("to"), 120)));
                note.set("battlefield", text(&battlefield));
                run.notes.push(with_ref(note, &moment));
                let reference = clean(moment.get("ref"), 120);
                if !reference.is_empty() {
                    let key = format!("{}:{}", reference, id);
                    if !run.captures_refused.contains(&key) {
                        run.captures_refused.push(key);
                    }
                }
                continue;
            }
            run.set_controller(&id, &clean(moment.get("to"), 120));
            for at in 0..run.battles.len() {
                if run.battles[at].status == "closed" || !run.battles[at].arena.index_of.contains_key(&id) {
                    continue;
                }
                let mut battle = lend(run, at);
                reconcile(&mut battle, run);
                give(run, at, battle);
                if run.battles[at].status == "active" {
                    let region = run.battles[at].arena.index_of[&id];
                    march_into(run, at, region, moment.get("to"), day);
                }
                run.battles[at].plan_key = String::new();
                run.battles[at].touched = true;
            }
        }
    }
    for at in 0..run.battles.len() {
        if !run.battles[at].closing.is_empty() && run.battles[at].status != "closed" {
            close_battle(run, at, day);
        }
    }
    for battle in run.battles.iter_mut() {
        if battle.status == "closed" || !battle.touched {
            continue;
        }
        read_sieges(battle);
        find_pockets(battle);
    }
    Ok(())
}

fn serving(troop_order: &Val, order: &Val) -> bool {
    troop_order.truthy() && !troop_order.read("done").truthy() && (troop_order.read("standing").same_ref(order) || troop_order.read("resume").read("standing").same_ref(order))
}

fn mark_attacks(run: &Run, at: usize) {
    let battle = &run.battles[at];
    if battle.status != "active" {
        return;
    }
    for order in battle.orders.clone() {
        let way = order.read("way");
        if !order.read("chosen").truthy() || way.as_array().map_or(true, |list| list.is_empty()) {
            continue;
        }
        let mut order = order;
        if word_is(&order.read("mark"), MIND_MARK) {
            order.unset("attacks");
            order.unset("crosses");
            continue;
        }
        let side = order.read("s").num() as usize;
        let (mut mid_x, mut mid_y, mut count) = (0.0, 0.0, 0.0);
        for troop in &battle.troops[side] {
            if !is_live(troop) || !serving(&troop.order, &order) {
                continue;
            }
            mid_x += troop.x;
            mid_y += troop.y;
            count += 1.0;
        }
        let route: Vec<[f64; 2]> = way.array_or_empty().iter().map(|point| battle.place.to_cell(point.at(0).num(), point.at(1).num())).collect();
        let path: Vec<[f64; 2]> = if count > 0.0 { std::iter::once([mid_x / count, mid_y / count]).chain(route).collect() } else { route };
        let names = others_on_way(&battle.arena, &battle.place, &path, |id| text(&holder_of(battle, run, id)), |name| side_of_name(battle, name) >= 0);
        let sender = sender_of(battle, &order);
        let elsewhere: Vec<String> = names.iter().filter(|name| other_front_against(run, at, &sender, name).is_some()).cloned().collect();
        let fresh: Vec<String> = names.iter().filter(|name| !elsewhere.contains(name)).cloned().collect();
        if !fresh.is_empty() {
            order.put("attacks", Val::Arr(fresh.iter().map(|name| text(name)).collect()));
        } else {
            order.unset("attacks");
        }
        if !elsewhere.is_empty() {
            order.put("crosses", Val::Arr(elsewhere.iter().map(|name| text(name)).collect()));
        } else {
            order.unset("crosses");
        }
    }
}

fn sender_of(battle: &Battle, order: &Val) -> String {
    let by = clean(&order.read("by"), 120);
    if !by.is_empty() {
        return by;
    }
    let side = order.read("s").num() as usize;
    lead_of(battle, side)
}

fn other_front_against(run: &Run, at: usize, member: &str, name: &str) -> Option<usize> {
    if member.is_empty() {
        return None;
    }
    fronts_between(run, member, name).into_iter().find(|&entry| entry != at && run.battles[entry].field.is_some())
}

fn on_route(battle: &Battle, order: &Val, day: f64) -> Vec<usize> {
    let side = order.read("s").num() as usize;
    let mut marching = Vec::new();
    for (at, troop) in battle.troops[side].iter().enumerate() {
        if !is_live(troop) {
            continue;
        }
        let mine = if troop.order.truthy() && !troop.order.read("done").truthy() { Some(troop.order.clone()) } else { None };
        let way = match mine {
            Some(mine) if !word_is(&mine.read("kind"), "way") => mine.read("resume"),
            Some(mine) => mine,
            None => Val::Undef,
        };
        if way.truthy() && !way.read("done").truthy() && way.read("standing").same_ref(order) && day >= way.read("since").num() {
            marching.push(at);
        }
    }
    marching
}

fn under_order(battle: &Battle, order: &Val) -> Vec<usize> {
    let side = order.read("s").num() as usize;
    battle.troops[side].iter().enumerate().filter(|(_, troop)| is_live(troop) && serving(&troop.order, order)).map(|(at, _)| at).collect()
}

fn reached_land_of(run: &Run, at: usize, order: &Val, name: &str, day: f64) -> bool {
    let battle = &run.battles[at];
    let arena = &battle.arena;
    let mut held = vec![0u8; arena.ids.len()];
    let mut any = false;
    for region in 1..arena.ids.len() {
        if fold_text(&holder_of(battle, run, &arena.ids[region])) != fold_text(name) {
            continue;
        }
        held[region] = 1;
        any = true;
    }
    if !any {
        return false;
    }
    let side = order.read("s").num() as usize;
    on_route(battle, order, day).into_iter().any(|index| {
        let troop = &battle.troops[side][index];
        land_within(arena, |region| held.get(region).copied() == Some(1), troop.x, troop.y, INVADE_REACH_KM / battle.place.km_at(troop.y))
    })
}

fn hand_over(run: &mut Run, at: usize, order: &Val, other_at: usize, day: f64) -> usize {
    let side = order.read("s").num() as usize;
    let date = run.date_of(day);
    let mut battle = lend(run, at);
    let mut other = lend(run, other_at);
    let mut moved: [Vec<usize>; 2] = [Vec::new(), Vec::new()];
    let (mut lng_sum, mut lat_sum) = (0.0, 0.0);
    for index in under_order(&battle, order) {
        let troop = battle.troops[side][index].clone();
        let member = if troop.owner >= 0.0 && troop.owner.fract() == 0.0 { battle.sides[side].get(troop.owner as usize).cloned() } else { None }.unwrap_or_else(|| sender_of(&battle, order));
        let their_side = side_of_name(&other, &member);
        if their_side < 0 || other.troops[their_side as usize].len() as f64 >= MAX_TROOPS_PER_SIDE {
            continue;
        }
        let their_side = their_side as usize;
        let [lng, lat] = battle.place.to_lng_lat(troop.x, troop.y);
        if battle.named.iter().any(|entry| entry.s == side && entry.i == index) {
            report_named(run, &mut battle, side, index, false);
        } else {
            let field = other.field.as_ref().unwrap();
            let [x, y] = other.place.to_cell(lng, lat);
            let (cols, rows) = (field.cols as f64, field.rows as f64);
            let inside = x >= 0.0 && y >= 0.0 && x < cols && y < rows;
            let here = if inside { (y.floor() * cols + x.floor()) as i64 } else { -1 };
            let cell = if inside && field.holders[here as usize] as usize == their_side { here } else { nearest_held_cell(field, their_side, jsmath::max(0.0, jsmath::min(cols - 1.0, x)), jsmath::max(0.0, jsmath::min(rows - 1.0, y)), HAND_OVER_REACH_CELLS) };
            if cell < 0 {
                continue;
            }
            let exact = inside && cell == here;
            let owner = jsmath::max(0.0, member_index(&other, their_side, &member) as f64);
            moved[their_side].push(other.troops[their_side].len());
            let (px, py) = if exact { (x, y) } else { ((cell % field.cols as i64) as f64 + 0.5, (cell / field.cols as i64) as f64 + 0.5) };
            other.troops[their_side].push(create_troop(TroopSeed { x: px, y: py, strength: troop.strength, kind: troop.kind, owner, ..TroopSeed::default() }));
            lng_sum += lng;
            lat_sum += lat;
        }
        let troop = &mut battle.troops[side][index];
        troop.strength = 0.0;
        troop.station = None;
        troop.order = Val::Null;
    }
    let count = moved[0].len() + moved[1].len();
    if under_order(&battle, order).is_empty() {
        battle.orders.retain(|entry| !entry.same_ref(order));
    }
    battle.touched = true;
    battle.plan_key = String::new();
    give(run, at, battle);
    if count == 0 {
        give(run, other_at, other);
        return 0;
    }
    let today = prepare(&mut other, day);
    for their_side in 0..2 {
        if moved[their_side].is_empty() {
            continue;
        }
        let mut entry = Obj::new();
        entry.set("s", num(their_side as f64));
        entry.set("sector", text("all"));
        entry.set("order", text("advance"));
        entry.set("since", text(&date));
        entry.set("age", num(0.0));
        entry.set("chosen", Val::Bool(true));
        entry.set("way", order.read("way").plain());
        let by = order.read("by");
        if by.truthy() {
            entry.set("by", by);
        }
        let mut entry = Val::shared(entry);
        other.orders.push(entry.clone());
        assign_order(&mut other, run, &mut entry, &order_day(&today, &date), Some(&moved[their_side]), false);
    }
    let near = city_near(run, lng_sum / count as f64, lat_sum / count as f64, 150.0);
    let place = if near.is_empty() { other.name.clone() } else { near };
    other.log.push(Val::obj([("d", text(&date)), ("k", text("reinforced")), ("s", num(if !moved[0].is_empty() { 0.0 } else { 1.0 })), ("at", text(&place))]));
    other.touched = true;
    other.plan_key = String::new();
    assign_commands(&mut other);
    give(run, other_at, other);
    count
}

fn invade_where_sent(run: &mut Run, at: usize, day: f64) -> Flow<()> {
    {
        let battle = &run.battles[at];
        if battle.status != "active" || !battle.orders.iter().any(|order| order.read("chosen").truthy() && (!texts_of(&order.read("attacks")).is_empty() || !texts_of(&order.read("crosses")).is_empty())) {
            return Ok(());
        }
    }
    let war_id = war_id_of(&run.battles[at]);
    match war_of(run, &war_id) {
        Some(war) if war.status == "active" && matches!(run.battles[at].war_id, Val::Str(_)) => {}
        _ => return Ok(()),
    }
    for order in run.battles[at].orders.clone() {
        if !order.read("chosen").truthy() {
            continue;
        }
        for name in texts_of(&order.read("crosses")) {
            let sender = sender_of(&run.battles[at], &order);
            let Some(other) = other_front_against(run, at, &sender, &name) else { continue };
            if !reached_land_of(run, at, &order, &name, day) {
                continue;
            }
            hand_over(run, at, &order, other, day);
            break;
        }
    }
    let settle_on = |order: &Val, name: &str| {
        let left: Vec<Val> = order.read("attacks").array_or_empty().iter().filter(|other| fold(other) != fold_text(name)).cloned().collect();
        let mut order = order.clone();
        if !left.is_empty() {
            order.put("attacks", Val::Arr(left));
        } else {
            order.unset("attacks");
        }
    };
    for order in run.battles[at].orders.clone() {
        if !order.read("chosen").truthy() {
            continue;
        }
        for name in texts_of(&order.read("attacks")) {
            if side_of_name(&run.battles[at], &name) >= 0 {
                settle_on(&order, &name);
                continue;
            }
            if war_side(&war_of(run, &war_id).unwrap(), &name) >= 0 {
                continue;
            }
            if !reached_land_of(run, at, &order, &name, day) {
                continue;
            }
            let side = order.read("s").num() as usize;
            let joins = battle_side(&run.battles[at], 1 - side);
            let moment = Val::obj([("type", text("war")), ("op", text(if joins == 0 { "join-a" } else { "join-b" })), ("warId", text(&war_id)), ("names", Val::Arr(vec![text(&name)])), ("sent", Val::Bool(true))]);
            apply_war_moment(run, &moment, day)?;
            if side_of_name(&run.battles[at], &name) < 0 {
                continue;
            }
            let date = run.date_of(day);
            let entry = Val::obj([("d", text(&date)), ("k", text("invaded")), ("s", num(side as f64)), ("at", text(&format!("{}: {}", kind_word(run, &name), name)))]);
            run.battles[at].log.push(entry);
            let by = clean(&order.read("by"), 120);
            let by = if by.is_empty() { run.battles[at].sides[side].first().cloned().unwrap_or_default() } else { by };
            run.joins.push(Val::obj([("day", num(day)), ("date", text(&date)), ("battlefield", battle_ref(at)), ("warId", text(&war_id)), ("name", text(&name)), ("side", num(joins as f64)), ("by", text(&by))]));
            settle_on(&order, &name);
            run.battles[at].touched = true;
            run.battles[at].plan_key = String::new();
        }
    }
    Ok(())
}

fn world_grid_of(run: &mut Run) -> Flow<Option<String>> {
    let input = run.input.clone();
    let map = input.get("map");
    let water = water_type_ids(run.input.get("regionTypes"));
    let map_key = clean(map.get("key"), 120);
    let key = world_sheet_key(&map_key, Some(&water));
    if !map_key.is_empty() && run.cache_on && run.grids.contains_key(&key) {
        return Ok(Some(key));
    }
    if run.grids.contains_key(OWN_GRID) {
        return Ok(Some(OWN_GRID.to_string()));
    }
    let Some(regions) = regions_of(run) else { return Err(RegionsNeeded) };
    let scale = match map.get("scale") {
        Val::Undef => None,
        other => Some(js::to_number(other)),
    };
    let measure = measure_of(map);
    let Some(grid) = build_world_grid(regions, &GridOptions { flat: map.get("flat").is_true(), scale, factor: Some(measure.factor), metric: measure.metric, step: 0.0, water: Some(water) }) else { return Ok(None) };
    if !map_key.is_empty() && run.cache_on {
        run.grids.insert(key.clone(), grid);
        return Ok(Some(key));
    }
    run.grids.insert(OWN_GRID.to_string(), grid);
    Ok(Some(OWN_GRID.to_string()))
}

fn transport_war(run: &Run, transport: &Transport) -> Option<War> {
    let fought = |war: &War| war.status == "active" && war_side(war, &transport.owner) >= 0;
    if let Some(named) = run.wars.get(&transport.war_id) {
        if fought(named) {
            return Some(named.clone());
        }
    }
    run.wars.values().find(|war| fought(war)).cloned()
}

fn holder_at_point(run: &Run, grid: &str, war: &War, lng: f64, lat: f64) -> String {
    let grid = &run.grids[grid];
    let cell = grid.cell_of(lng, lat);
    let mark = if cell >= 0.0 { grid.region[cell as usize] } else { 0 };
    if mark != 0 {
        clean_text(&holder_in(run, war, &grid.ids[mark as usize]), 120)
    } else {
        String::new()
    }
}

fn city_near(run: &Run, lng: f64, lat: f64, within_km: f64) -> String {
    let surface = measure_of(run.input.get("map"));
    let mut best: Option<(f64, String)> = None;
    for city in run.input.get("map").get("cities").array_or_empty() {
        let far = km_between(lng, lat, js::to_number(city.get("lng")), js::to_number(city.get("lat")), surface);
        if far <= within_km && best.as_ref().map_or(true, |(least, _)| far < *least) {
            best = Some((far, clean(city.get("name"), 120)));
        }
    }
    best.map_or(String::new(), |(_, name)| format!("city: {}", name))
}

fn tell_voyage(run: &mut Run, day: f64, k: &str, transport: &Transport, extra: Vec<(&str, Val)>) {
    let mut entry = Obj::new();
    entry.set("d", text(&run.date_of(day)));
    entry.set("day", num(day));
    entry.set("k", text(k));
    entry.set("id", text(&transport.id));
    entry.set("owner", text(&transport.owner));
    entry.set("kind", text(&transport.kind));
    entry.set("medium", text(&transport.medium));
    entry.set("to", text(&bound_for(transport)));
    entry.set("n", num(load_of(transport)));
    for (key, value) in extra {
        entry.set(key, value);
    }
    run.voyages.push(Val::Obj(entry));
}

fn place_named(run: &Run, grid: &str, war: &War, value: &Val) -> Flow<Option<(f64, f64, String)>> {
    let named = named_kind(value, &["city", "region", "country", "group"]);
    let wanted = match &named {
        Some((_, rest)) => fold_text(rest),
        None => fold(value),
    };
    let kind = named.as_ref().map_or("", |(kind, _)| kind.as_str());
    if wanted.is_empty() {
        return Ok(None);
    }
    let cities = run.input.get("map").get("cities").array_or_empty();
    if kind != "region" && kind != "country" && kind != "group" {
        if let Some(city) = cities.iter().find(|entry| fold(entry.get("name")) == wanted) {
            return Ok(Some((js::to_number(city.get("lng")), js::to_number(city.get("lat")), format!("city: {}", clean(city.get("name"), 120)))));
        }
        if kind == "city" {
            return Ok(None);
        }
    }
    if kind != "region" {
        if let Some(seat) = seat_of(run, grid, war, &wanted) {
            return Ok(Some(seat));
        }
        if kind == "country" || kind == "group" {
            return Ok(None);
        }
    }
    let Some(regions) = regions_of(run) else { return Err(RegionsNeeded) };
    let Some(region) = regions.iter().find(|entry| fold(entry.get("name")) == wanted) else { return Ok(None) };
    let [lng, lat] = middle_of(region);
    Ok(Some((lng, lat, format!("region: {}", clean(region.get("name"), 120)))))
}

fn seat_of(run: &Run, grid: &str, war: &War, wanted: &str) -> Option<(f64, f64, String)> {
    let mut best: Option<(f64, f64, f64, String)> = None;
    for city in run.input.get("map").get("cities").array_or_empty() {
        let (lng, lat) = (js::to_number(city.get("lng")), js::to_number(city.get("lat")));
        if fold_text(&holder_at_point(run, grid, war, lng, lat)) != wanted {
            continue;
        }
        let population = js::to_number(city.get("population"));
        let weight = (if city.get("capital").truthy() { 1e12 } else { 0.0 }) + jsmath::max(0.0, if population.is_nan() { 0.0 } else { population });
        if best.as_ref().map_or(true, |(most, ..)| weight > *most) {
            best = Some((weight, lng, lat, format!("city: {}", clean(city.get("name"), 120))));
        }
    }
    best.map(|(_, lng, lat, name)| (lng, lat, name))
}

fn origins_of(run: &Run, grid: &str, war: &War, transport: &Transport) -> Vec<(f64, f64, String)> {
    let surface = measure_of(run.input.get("map"));
    let mut mine: Vec<(f64, f64, String, f64)> = Vec::new();
    let to = (transport.to.lng.unwrap_or(f64::NAN), transport.to.lat.unwrap_or(f64::NAN));
    for city in run.input.get("map").get("cities").array_or_empty() {
        let (lng, lat) = (js::to_number(city.get("lng")), js::to_number(city.get("lat")));
        if !(lng + lat).is_finite() || fold_text(&holder_at_point(run, grid, war, lng, lat)) != fold_text(&transport.owner) {
            continue;
        }
        mine.push((lng, lat, format!("city: {}", clean(city.get("name"), 120)), km_between(lng, lat, to.0, to.1, surface)));
    }
    js::stable_sort_by(&mut mine, |a, b| {
        let by = a.3 - b.3;
        if by != 0.0 && !by.is_nan() {
            by
        } else {
            match js::compare_units(&a.2, &b.2) {
                std::cmp::Ordering::Less => -1.0,
                std::cmp::Ordering::Greater => 1.0,
                std::cmp::Ordering::Equal => 0.0,
            }
        }
    });
    mine.into_iter().take(8).map(|(lng, lat, name, _)| (lng, lat, name)).collect()
}

fn sails_in_peace(transport: &Transport) -> bool {
    clean_text(&transport.war_id, 120).is_empty() && transport.attacks.as_ref().is_some_and(|attacks| !attacks.is_empty())
}

fn load_val(load: &[[f64; 2]]) -> Val {
    Val::Arr(load.iter().map(|pair| Val::nums(pair)).collect())
}

fn place_of(lng: f64, lat: f64, name: &str) -> Place {
    Place { lng: Some(lng), lat: Some(lat), name: name.to_string() }
}

fn finite_place(place: &Place) -> bool {
    place.lng.is_some_and(f64::is_finite) && place.lat.is_some_and(f64::is_finite)
}

fn refuse(run: &mut Run, index: usize, transport: &Transport, note: &str, day: f64) {
    let date = run.date_of(day);
    run.transports[index] = Transport { status: "refused".to_string(), note: note.to_string(), ended: date, ..transport.clone() };
    tell_voyage(run, day, "refused", transport, vec![("why", text(note))]);
}

fn depart_transport(run: &mut Run, index: usize, day: f64) -> Flow<()> {
    let mut transport = run.transports[index].clone();
    let date = run.date_of(day);
    if run.mech.military() && transport.medium == "sea" && sea_worth(&run.military_of(&transport.owner)) == 0.0 {
        refuse(run, index, &transport, "no-navy", day);
        return Ok(());
    }
    if run.mech.military() && transport.medium == "air" && air_worth(&run.military_of(&transport.owner)) == 0.0 {
        refuse(run, index, &transport, "no-air-force", day);
        return Ok(());
    }
    let mut war = transport_war(run, &transport);
    let grid = world_grid_of(run)?;
    let mut surprise = String::new();
    if war.is_none() {
        let Some(grid) = &grid else {
            refuse(run, index, &transport, "off-map", day);
            return Ok(());
        };
        let alone = peace_of(&transport.owner, Vec::new());
        let place = if finite_place(&transport.to) { Some((transport.to.lng.unwrap(), transport.to.lat.unwrap())) } else { place_named(run, grid, &alone, &text(&transport.to.name))?.map(|(lng, lat, _)| (lng, lat)) };
        let holder = place.map_or(String::new(), |(lng, lat)| holder_at_point(run, grid, &alone, lng, lat));
        if holder.is_empty() || fold_text(&holder) == fold_text(&transport.owner) || war_between(run, &transport.owner, &holder).is_some() {
            refuse(run, index, &transport, "no-war", day);
            return Ok(());
        }
        war = Some(peace_of(&transport.owner, vec![holder.clone()]));
        surprise = holder;
    }
    let Some(grid) = grid else {
        refuse(run, index, &transport, "off-map", day);
        return Ok(());
    };
    let war = war.unwrap();
    let mine = war_side(&war, &transport.owner);
    if !finite_place(&transport.to) {
        let Some((lng, lat, name)) = place_named(run, &grid, &war, &text(&transport.to.name))? else {
            refuse(run, index, &transport, "no-place", day);
            return Ok(());
        };
        transport = Transport { to: place_of(lng, lat, &name), ..transport };
    }
    let mut load = transport.load.clone();
    let mut origins: Vec<(f64, f64, String)> = match &transport.from {
        Some(from) => vec![(from.lng.unwrap_or(f64::NAN), from.lat.unwrap_or(f64::NAN), from.name.clone())],
        None => Vec::new(),
    };
    let mut boarding: Option<(usize, usize, Vec<usize>)> = None;
    if let Some(embark) = transport.embark.clone() {
        let wanted = fold_battlefield_name(&text(&embark.battlefield));
        let found = run.battles.iter().position(|entry| entry.status != "closed" && fold_battlefield_name(&text(&entry.name)) == wanted);
        let side = embark.side as usize;
        let picked: Vec<usize> = match found {
            Some(at) => {
                let battle = &run.battles[at];
                embark
                    .troops
                    .iter()
                    .filter(|&&index| index >= 0.0 && index.fract() == 0.0)
                    .map(|&index| index as usize)
                    .filter(|&index| side < 2 && battle.troops[side].get(index).is_some_and(is_live) && !battle.named.iter().any(|entry| entry.s == side && entry.i == index))
                    .collect()
            }
            None => Vec::new(),
        };
        if picked.is_empty() {
            refuse(run, index, &transport, "no-troops", day);
            return Ok(());
        }
        let at = found.unwrap();
        let battle = &run.battles[at];
        let (mut x, mut y) = (0.0, 0.0);
        for &index in &picked {
            x += battle.troops[side][index].x;
            y += battle.troops[side][index].y;
        }
        let [lng, lat] = battle.place.to_lng_lat(x / picked.len() as f64, y / picked.len() as f64);
        origins = vec![(lng, lat, city_near(run, lng, lat, 150.0))];
        load = picked.iter().map(|&index| [jsmath::round(battle.troops[side][index].strength), battle.troops[side][index].kind]).collect();
        boarding = Some((at, side, picked));
    } else if load.is_empty() {
        let raise = transport.raise.filter(|raise| *raise != 0.0 && !raise.is_nan()).unwrap_or(1.0);
        let kinds = kinds_for(jsmath::max(1.0, raise) as usize, run.era, if run.mech.military() { mix_of(&run.military_of(&transport.owner)) } else { None });
        load = kinds.iter().map(|&kind| [100.0, kind]).collect();
        draw(run, &transport.owner, load.len() as f64 * men_of(run, &transport.owner));
        if origins.is_empty() {
            origins = origins_of(run, &grid, &war, &transport);
        }
    }
    if origins.is_empty() {
        refuse(run, index, &transport, "no-origin", day);
        return Ok(());
    }
    let loaded = Transport { embark: None, raise: None, load, war_id: war.id.clone(), ..transport.clone() };
    let mut sheet = run.grids.remove(&grid).unwrap();
    let year = {
        let year = game_date_year(&run.date_of(0.0));
        match run.input.get("era") {
            Val::Num(era) if era.is_finite() && era.fract() == 0.0 => Some(year_in_era(year.unwrap_or(f64::NAN), Some(*era))),
            _ => year,
        }
    };
    let mut out: Option<Transport> = None;
    {
        let run_ref: &Run = run;
        let holder = |id: &str| holder_in(run_ref, &war, id);
        let friendly = |name: &str| war_side(&war, name) == mine;
        let hostile = |name: &str| war_side(&war, name) == 1 - mine;
        let date_of = |days: f64| run_ref.date_of(day + days);
        for (lng, lat, name) in &origins {
            let from = Val::nums(&[*lng, *lat]);
            let setting = Transport { from: Some(place_of(*lng, *lat, &clean_text(name, 120))), ..loaded.clone() };
            let gone = set_out(&setting, SetOut { grid: &mut sheet, from: &from, holder_of: &holder, friendly: &friendly, hostile: &hostile, year, date: &date, date_of: &date_of });
            let moving = gone.status == "moving";
            out = Some(gone);
            if moving {
                break;
            }
        }
    }
    run.grids.insert(grid.clone(), sheet);
    let mut out = out.unwrap();
    if out.status != "moving" {
        let note = if out.note.is_empty() { "no-way".to_string() } else { out.note.clone() };
        refuse(run, index, &transport, &note, day);
        return Ok(());
    }
    let landing = out.landing.unwrap_or([f64::NAN, f64::NAN]);
    let holder = holder_at_point(run, &grid, &war, landing[0], landing[1]);
    if !surprise.is_empty() {
        out.attacks = Some(vec![if !holder.is_empty() && fold_text(&holder) != fold_text(&transport.owner) { holder } else { surprise }]);
    } else if !holder.is_empty() && war_side(&war, &holder) < 0 {
        out.attacks = Some(vec![holder]);
    }
    if let Some((at, side, picked)) = boarding {
        let battle = &mut run.battles[at];
        for index in picked {
            battle.troops[side][index].strength = 0.0;
            battle.troops[side][index].station = None;
        }
        battle.touched = true;
        battle.plan_key = String::new();
    }
    run.transports[index] = out.clone();
    let from = out.from.as_ref().map_or(String::new(), |from| from.name.clone());
    tell_voyage(run, day, "sailed", &out, vec![("from", text(&from)), ("due", text(&out.due)), ("km", num(out.km))]);
    Ok(())
}

fn land_transport(run: &mut Run, index: usize, day: f64) -> Flow<()> {
    let transport = run.transports[index].clone();
    let date = run.date_of(day);
    let end = |run: &mut Run, status: &str, k: &str, extra: Vec<(&str, Val)>| {
        let at = transport.landing.or(transport.at);
        run.transports[index] = Transport { status: status.to_string(), ended: date.clone(), at, ..transport.clone() };
        tell_voyage(run, day, k, &transport, extra);
    };
    let mut war = transport_war(run, &transport);
    let grid = world_grid_of(run)?;
    let [lng, lat] = transport.landing.unwrap_or([transport.to.lng.unwrap_or(f64::NAN), transport.to.lat.unwrap_or(f64::NAN)]);
    let mut opened = String::new();
    if war.is_none() && sails_in_peace(&transport) {
        let target = match &grid {
            Some(grid) => holder_at_point(run, grid, &peace_of(&transport.owner, Vec::new()), lng, lat),
            None => String::new(),
        };
        let before = run.starts.len();
        let id = if !target.is_empty() && fold_text(&target) != fold_text(&transport.owner) { attack_opens_war(run, &transport.owner, &target, day, true)? } else { None };
        war = id.and_then(|id| war_of(run, &id));
        if war.is_some() && run.starts.len() > before {
            opened = target;
        }
    }
    let Some(mut war) = war else {
        end(run, "returned", "returned", Vec::new());
        return Ok(());
    };
    let mine = war_side(&war, &transport.owner);
    let holder = match &grid {
        Some(grid) => holder_at_point(run, grid, &war, lng, lat),
        None => String::new(),
    };
    let mut joined = String::new();
    if !holder.is_empty() && war_side(&war, &holder) < 0 {
        let moment = Val::obj([("type", text("war")), ("op", text(if mine == 0 { "join-b" } else { "join-a" })), ("warId", text(&war.id)), ("names", Val::Arr(vec![text(&holder)])), ("sent", Val::Bool(true))]);
        apply_war_moment(run, &moment, day)?;
        if !war.id.is_empty() {
            if let Some(now) = war_of(run, &war.id) {
                war = now;
            }
        }
        if war_side(&war, &holder) < 0 {
            end(run, "returned", "returned", vec![("why", text("no-room"))]);
            return Ok(());
        }
        joined = holder;
    }
    let mut battle = run.battles.iter().position(|entry| is_of_war(entry, &war.id) && entry.status == "active" && side_of_name(entry, &transport.owner) >= 0 && point_in_frame(&entry.frame, lng, lat));
    let mut hostile = true;
    let mut landed = 0;
    if let Some(at) = battle {
        let mut lent = lend(run, at);
        let side = side_of_name(&lent, &transport.owner) as usize;
        let [x, y] = lent.place.to_cell(lng, lat);
        let owner = jsmath::max(0.0, member_index(&lent, side, &transport.owner) as f64);
        let put = land_carried(&mut lent, side, x, y, &load_val(&transport.load), owner, &date);
        landed = put.landed;
        hostile = put.hostile;
        let settles = landed > 0 && hostile && lent.city_holder.is_some();
        if landed > 0 {
            lent.touched = true;
        }
        give(run, at, lent);
        if landed == 0 {
            battle = None;
        } else if settles {
            settle(run, at, day);
        }
    } else {
        let before = run.battles.len();
        let wanted = fold_battlefield_name(&text(&transport.battlefield));
        let named = if run.battles.iter().any(|entry| entry.status != "closed" && fold_battlefield_name(&text(&entry.name)) == wanted) { String::new() } else { transport.battlefield.clone() };
        battle = open_landing_at(run, &war, &transport.owner, lng, lat, &text(&named), day, Some(&load_val(&transport.load)))?;
        if let Some(at) = battle {
            let side = side_of_name(&run.battles[at], &transport.owner);
            landed = transport.load.len().min(if side >= 0 { run.battles[at].troops[side as usize].len() } else { 0 });
            let name = run.battles[at].name.clone();
            let order = Val::obj([("type", text("order")), ("battlefield", text(&name)), ("side", text(&transport.owner)), ("order", text("advance")), ("sector", text("all"))]);
            order_on_front(run, at, &order, day)?;
        } else if run.battles.len() > before {
            run.battles.truncate(before);
        }
    }
    if !joined.is_empty() {
        let field = match battle {
            Some(at) => battle_ref(at),
            None => Val::obj([("name", text(""))]),
        };
        run.joins.push(Val::obj([("day", num(day)), ("date", text(&date)), ("battlefield", field), ("warId", text(&war.id)), ("name", text(&joined)), ("side", num((1 - mine) as f64)), ("by", text(&transport.owner))]));
        let at = format!("{}: {}", kind_word(run, &joined), joined);
        tell_voyage(run, day, "invaded", &transport, vec![("at", text(&at))]);
    }
    if !opened.is_empty() {
        let at = format!("{}: {}", kind_word(run, &opened), opened);
        tell_voyage(run, day, "invaded", &transport, vec![("at", text(&at)), ("opened", Val::Bool(true))]);
        if let Some(at) = battle {
            tell_attack(run, at, &transport.owner, &opened, day);
        }
    }
    let Some(at) = battle.filter(|_| landed > 0) else {
        end(run, "returned", "returned", vec![("why", text("no-landing"))]);
        return Ok(());
    };
    let near = city_near(run, lng, lat, 120.0);
    let place = if !near.is_empty() {
        near
    } else if !transport.to.name.is_empty() {
        transport.to.name.clone()
    } else {
        let battle = &run.battles[at];
        let [x, y] = battle.place.to_cell(lng, lat);
        let cell = jsmath::max(0.0, y.floor() * battle.arena.cols as f64 + x.floor());
        let name = if cell.is_finite() { battle.arena.region.get(cell as usize).and_then(|&region| battle.arena.names.get(region as usize)).cloned().unwrap_or_default() } else { String::new() };
        format!("region: {}", name)
    };
    let side = side_of_name(&run.battles[at], &transport.owner);
    let word = if hostile { "landed" } else { "reinforced" };
    let entry = Val::obj([("d", text(&date)), ("k", text(word)), ("s", num(side as f64)), ("at", text(&place))]);
    run.battles[at].log.push(entry);
    run.battles[at].plan_key = String::new();
    run.transports[index] = Transport { status: "landed".to_string(), ended: date.clone(), at: Some([lng, lat]), battlefield: run.battles[at].name.clone(), war_id: war.id.clone(), ..transport.clone() };
    tell_voyage(run, day, word, &transport, vec![("at", text(&place)), ("battlefield", battle_ref(at)), ("landed", num(landed as f64))]);
    Ok(())
}

fn begin_transports(run: &mut Run) -> Flow<()> {
    let first = run.date_of(0.0);
    run.transports = normalize_transports(run.input.get("transports")).into_iter().filter(|transport| !TRANSPORT_ENDED.contains(&transport.status.as_str()) || (!transport.ended.is_empty() && compare_game_dates(&transport.ended, &first) > 0.0)).collect();
    if run.days <= 0.0 {
        return Ok(());
    }
    for index in 0..run.transports.len() {
        if run.transports[index].status == "ordered" {
            depart_transport(run, index, 0.0)?;
        }
    }
    Ok(())
}

fn move_transports(run: &mut Run, day: f64) -> Flow<()> {
    let measure = measure_of(run.input.get("map"));
    let surface = Surface::plain(measure.flat, measure.scale);
    let date = run.date_of(day);
    for index in 0..run.transports.len() {
        let before = run.transports[index].clone();
        if before.status != "moving" || before.departed == date {
            continue;
        }
        let mut peace = false;
        let war = match transport_war(run, &before) {
            Some(war) => Some(war),
            None if sails_in_peace(&before) => {
                peace = true;
                Some(peace_of(&before.owner, before.attacks.clone().unwrap_or_default()))
            }
            None => None,
        };
        let Some(war) = war else {
            run.transports[index] = Transport { status: "returned".to_string(), ended: date.clone(), ..before.clone() };
            tell_voyage(run, day, "returned", &before, Vec::new());
            continue;
        };
        let (moved, arrived) = move_on(&before, surface);
        run.transports[index] = moved.clone();
        let mine = war_side(&war, &moved.owner);
        let middle = place_along(&moved.way, (before.gone + moved.gone) / 2.0, measure);
        let grid = world_grid_of(run)?;
        let at = match &middle {
            Some(middle) => [middle.lng, middle.lat],
            None => moved.at.unwrap_or([f64::NAN, f64::NAN]),
        };
        let risk = {
            let run_ref: &Run = run;
            let sheet: Option<&WorldGrid> = grid.as_ref().map(|key| &run_ref.grids[key]);
            let enemy = |name: &str| !peace && war_side(&war, name) == 1 - mine;
            let ally = |name: &str| war_side(&war, name) == mine;
            let holder = |id: &str| text(&holder_in(run_ref, &war, id));
            interception_of(&moved, at, Watch { units: run_ref.input.get("units").array_or_empty(), enemy: &enemy, ally: &ally, grid: sheet, holder_of: &holder, surface })
        };
        if risk.chance > 0.0 && transport_chance(&run.seed, &moved.id, day, "caught") < risk.chance {
            let (hit, lost) = struck(&moved, transport_chance(&run.seed, &moved.id, day, "hurt"), &date);
            let gone = hit.status == "lost";
            run.transports[index] = hit;
            let near = match &middle {
                Some(middle) => city_near(run, middle.lng, middle.lat, 250.0),
                None => String::new(),
            };
            let place = match &middle {
                Some(middle) => Val::nums(&[jsmath::round(middle.lng * 1000.0) / 1000.0, jsmath::round(middle.lat * 1000.0) / 1000.0]),
                None => Val::Null,
            };
            tell_voyage(run, day, if gone { "lost" } else { "intercepted" }, &moved, vec![("by", text(&risk.by)), ("with", text(&risk.with)), ("lost", num(lost)), ("at", text(&near)), ("where", place)]);
            if gone {
                continue;
            }
        }
        if arrived {
            land_transport(run, index, day)?;
        }
    }
    Ok(())
}

fn must_have_regions(run: &Run) -> bool {
    let records = normalize_battlefields(run.input.get("battlefields"));
    let open_named = |names: &[String]| records.iter().any(|record| !word_is(record.get("status"), "closed") && names.contains(&fold_battlefield_name(record.get("name"))));
    run.moments.iter().any(|entry| {
        let moment = &entry.moment;
        if word_is(moment.get("type"), "war") {
            return word_in(moment.get("op"), &["start", "join-a", "join-b", "resume"]);
        }
        if !word_is(moment.get("type"), "order") {
            return false;
        }
        if let Some(country) = prefixed_name(moment.get("battlefield"), "home") {
            let wanted = fold_battlefield_name(&text(&home_name(&country)));
            return !records.iter().any(|record| record.get("home").is_true() && !word_is(record.get("status"), "closed") && fold_battlefield_name(record.get("name")) == wanted);
        }
        if let Some((first, second)) = border_names(moment.get("battlefield")) {
            let (first, second) = (clean_text(&first, 120), clean_text(&second, 120));
            let names = [fold_battlefield_name(&text(&format!("{} / {} border", first, second))), fold_battlefield_name(&text(&format!("{} / {} border", second, first)))];
            return !open_named(&names);
        }
        if !word_is(moment.get("order"), "land") {
            return false;
        }
        !open_named(&[fold_battlefield_name(moment.get("battlefield"))])
    })
}

fn begin(run: &mut Run) -> Flow<()> {
    let input = run.input.clone();
    let map = input.get("map");
    let list_key = format!("regions|{}", clean(map.get("key"), 120));
    if let Some(regions) = regions_of(run) {
        let ids: Vec<Val> = regions.iter().map(|region| clean(region.get("id"), 120)).filter(|id| !id.is_empty()).map(|id| text(&id)).collect();
        run.region_ids = Val::Arr(ids);
        if run.cache_on && !clean(map.get("key"), 120).is_empty() {
            run.kept_lists.insert(list_key, run.region_ids.clone());
        }
    } else {
        run.region_ids = run.kept_lists.get(&list_key).cloned().unwrap_or(Val::Null);
        if must_have_regions(run) {
            return Err(RegionsNeeded);
        }
    }
    for record in normalize_battlefields(run.input.get("battlefields")) {
        if word_is(record.get("status"), "closed") || !record.get("field").truthy() {
            continue;
        }
        let Some(arena) = arena_at(run, &frame_from(record.get("frame"))) else { return Err(RegionsNeeded) };
        let battle = load_battle(run, &record, arena);
        run.battles.push(battle);
    }
    for at in 0..run.battles.len() {
        sync_with_war(run, at);
        let mut battle = lend(run, at);
        reconcile(&mut battle, run);
        set_radii(&mut battle);
        give(run, at, battle);
    }
    for at in 0..run.battles.len() {
        if !run.battles[at].closing.is_empty() {
            continue;
        }
        let mut battle = lend(run, at);
        if battle.status == "active" {
            absorb_units(run, &mut battle, at);
        }
        let handed = if battle.status == "active" { bring_home(run, &mut battle, 0.0) } else { Vec::new() };
        set_radii(&mut battle);
        paint_ground(&mut battle, run);
        keep_start(&mut battle);
        read_sieges(&mut battle);
        find_pockets(&mut battle);
        start_recorder(&mut battle, run, 0.0, None);
        let active = battle.status == "active";
        let orders = battle.orders.clone();
        give(run, at, battle);
        if active {
            for order in orders {
                if order.read("objective").truthy() {
                    hold_objective(run, at, &order.read("objective"), 0.0)?;
                }
            }
        }
        assign_standing(run, at);
        home_orders(run, at, handed, 0.0);
        mark_attacks(run, at);
    }
    let input = run.input.clone();
    for unit in input.get("units").array_or_empty().iter().cloned() {
        let committed = clean(unit.get("committedTo"), 120);
        let id = clean(unit.get("id"), 120);
        if committed.is_empty() || id.is_empty() {
            continue;
        }
        let wanted = fold_battlefield_name(&text(&committed));
        let battle = run.battles.iter().find(|entry| fold_battlefield_name(&text(&entry.name)) == wanted);
        if battle.map_or(true, |battle| !battle.named.iter().any(|entry| matches!(&entry.unit_id, Val::Str(own) if *own == id))) {
            run.unit_changes.push(Val::obj([("unitId", text(&id)), ("committedTo", text(""))]));
        }
    }
    for at in 0..run.battles.len() {
        if !run.battles[at].closing.is_empty() {
            keep_start(&mut run.battles[at]);
            close_battle(run, at, 0.0);
        } else {
            let last = run.days == 0.0;
            record_day(&mut run.battles[at], 0.0, last);
        }
    }
    let standing = run.battles.len();
    for at in 0..standing {
        attack_from_standing(run, at)?;
    }
    let ids: Vec<String> = run.wars.keys().cloned().collect();
    for id in ids {
        examine_war(run, &id, 0.0)?;
    }
    if run.braked {
        run.notes.push(Val::obj([("kind", text("tempo"))]));
    }
    begin_transports(run)?;
    for battle in run.battles.iter_mut() {
        battle.touched = false;
    }
    call_up_deployed(run);
    apply_moments(run, 0.0)?;
    let last = run.days == 0.0;
    for battle in run.battles.iter_mut() {
        if battle.touched && battle.status != "closed" && battle.recorded == 0.0 {
            record_day(battle, 0.0, last);
        }
    }
    for battle in run.battles.iter_mut() {
        if battle.status != "closed" {
            assign_commands(battle);
        }
    }
    Ok(())
}

fn assign_standing(run: &mut Run, at: usize) {
    if run.battles[at].status == "closed" || run.battles[at].orders.is_empty() {
        return;
    }
    let mut battle = lend(run, at);
    let today = prepare(&mut battle, 0.0);
    let date = run.date_of(0.0);
    let mut turns: Vec<usize> = (0..battle.orders.len()).collect();
    let chosen: Vec<f64> = battle.orders.iter().map(|order| if order.read("chosen").truthy() { 1.0 } else { 0.0 }).collect();
    js::stable_sort_by(&mut turns, |&a, &b| {
        let by = chosen[a] - chosen[b];
        if by != 0.0 {
            by
        } else {
            a as f64 - b as f64
        }
    });
    for index in turns {
        let Some(order) = battle.orders.get(index).cloned() else { continue };
        let side = order.read("s").num() as usize;
        let mut picked = Vec::new();
        if battle.served {
            for (at, troop) in battle.troops[side].iter().enumerate() {
                if troop.serves == index as f64 {
                    picked.push(at);
                }
            }
        }
        if order.read("chosen").truthy() && picked.is_empty() {
            continue;
        }
        let lagless = order.read("age").num() > 0.0;
        let mut order = order;
        assign_order(&mut battle, run, &mut order, &order_day(&today, &date), if picked.is_empty() { None } else { Some(&picked) }, lagless);
    }
    give(run, at, battle);
}

pub type MindBody = Body;

fn end_of(order: &Option<Val>) -> String {
    let Some(order) = order else { return String::new() };
    if !word_is(&order.read("mark"), MIND_MARK) {
        return String::new();
    }
    match order.read("way") {
        Val::Arr(points) if !points.is_empty() => joined(points[points.len() - 1].array_or_empty(), ","),
        _ => "out".to_string(),
    }
}

fn order_troops_by_mind(run: &Run, battle: &mut Battle, side: usize, bodies: &[MindBody], day: f64, today: &Today, lead: &str) {
    let date = run.date_of(day);
    let was: Vec<String> = battle.troops[side].iter().map(|troop| if is_live(troop) { end_of(&standing_of(battle, troop)) } else { String::new() }).collect();
    battle.orders.retain(|order| order.read("s").num() != side as f64 || (order.read("chosen").truthy() && !word_is(&order.read("mark"), MIND_MARK)));
    let mut aim = [0.0f64; 2];
    for body in bodies {
        let picked: Vec<usize> = body.picked.iter().copied().filter(|&index| battle.troops[side].get(index).is_some_and(is_live)).collect();
        if picked.is_empty() {
            continue;
        }
        if body.order == "hold" || body.order == "dig in" {
            let mut order = Val::obj([("s", num(side as f64)), ("sector", text("all")), ("order", text(&body.order)), ("since", text(&date)), ("age", num(0.0))]).share();
            assign_order(battle, run, &mut order, &order_day(today, &date), Some(&picked), false);
            continue;
        }
        let mut obj = Obj::new();
        obj.set("s", num(side as f64));
        obj.set("sector", text("all"));
        obj.set("order", text(if body.order == "rest" { "fall back" } else { "advance" }));
        obj.set("since", text(&date));
        obj.set("age", num(0.0));
        obj.set("chosen", Val::Bool(true));
        obj.set("mark", text(MIND_MARK));
        if !lead.is_empty() {
            obj.set("by", text(lead));
        }
        if body.order == "rest" {
            let order = Val::shared(obj);
            battle.orders.push(order.clone());
            for index in picked {
                let (x, y) = (battle.troops[side][index].x, battle.troops[side][index].y);
                let mut target = Val::Null;
                if let Some(to_side) = &battle.to_side {
                    if downhill(battle.field.as_ref().unwrap(), &to_side.sides[1 - side], x, y, &mut aim) {
                        let cells = REST_KM / battle.place.km_at(y);
                        target = Val::obj([("x", num(x - aim[0] * cells)), ("y", num(y - aim[1] * cells))]);
                    }
                }
                let troop = &mut battle.troops[side][index];
                if troop.dug {
                    troop.state = STATE_HOLDING;
                }
                troop.dug = false;
                troop.order = Val::obj([("kind", text("fallback")), ("standing", order.clone()), ("target", target), ("since", num(day)), ("day", num(day)), ("gone", num(0.0))]);
                troop.fallback = Val::Null;
            }
            continue;
        }
        if let Some(way) = body.way.as_ref().filter(|way| !way.is_empty()) {
            obj.set("way", Val::Arr(way.iter().map(|point| Val::nums(point)).collect()));
        }
        let mut order = Val::shared(obj);
        battle.orders.push(order.clone());
        let end = end_of(&Some(order.clone()));
        let lagless = picked.iter().all(|&index| was[index] == end);
        assign_order(battle, run, &mut order, &order_day(today, &date), Some(&picked), lagless);
    }
    battle.orders_changed += 1.0;
    battle.touched = true;
    battle.plan_key = String::new();
}

fn review_staff(run: &mut Run, at: usize, day: f64, regular: bool) {
    if matches!(run.input.get("staff"), Val::Bool(false)) {
        return;
    }
    let war_id = war_id_of(&run.battles[at]);
    let active = matches!(run.battles[at].war_id, Val::Str(_)) && war_of(run, &war_id).is_some_and(|war| war.status == "active");
    if !active {
        return;
    }
    let mut battle = lend(run, at);
    let date = run.date_of(day);
    let players = run.input.get("players").clone();
    let mut today: Option<Today> = None;
    let begun = battle.begun;
    battle.begun = false;
    if begun {
        let side = if battle.swap { 1 } else { 0 };
        let peaceful = battle.orders.iter().filter(|order| order.read("s").num() == side as f64 && !order.read("chosen").truthy()).all(|order| !is_attack_word(&order.read("order")) && !matches!(order.read("since"), Val::Str(since) if since == date));
        if !battle.away[side] && !side_is_played(&battle, side, &players) && peaceful && live_count(&battle.troops[side]) > 0 {
            today = Some(prepare(&mut battle, day));
            let lead = lead_of(&battle, side);
            battle.orders.retain(|order| order.read("s").num() != side as f64 || order.read("chosen").truthy());
            let mut order = set_standing_order(&mut battle, side, &Val::obj([("sector", text("all")), ("order", text("advance")), ("since", text(&date)), ("age", num(0.0)), ("by", text(&lead)), ("mark", text(STAFF_MARK))]));
            assign_order(&mut battle, run, &mut order, &order_day(today.as_ref().unwrap(), &date), None, false);
            battle.touched = true;
            battle.plan_key = String::new();
            battle.log.push(Val::obj([("d", text(&date)), ("k", text("offensive")), ("s", num(side as f64)), ("at", text("the whole line"))]));
            battle.begun_by = Some(side);
        }
    }
    let opener = if battle.swap { 1 } else { 0 };
    let opening = if battle.opened_date.truthy() { diff_game_days(&battle.opened_date.string_or_empty(), &date) } else { None };
    if !begun && !battle.opened_for && opening.is_some_and(|days| days <= 1.0) && !battle.away[opener] && side_is_played(&battle, opener, &players) && !battle.orders.iter().any(|order| order.read("s").num() == opener as f64) && live_count(&battle.troops[opener]) > 0 {
        battle.opened_for = true;
        if today.is_none() {
            today = Some(prepare(&mut battle, day));
        }
        let lead = lead_of(&battle, opener);
        let mut order = set_standing_order(&mut battle, opener, &Val::obj([("sector", text("all")), ("order", text("advance")), ("since", text(&date)), ("age", num(0.0)), ("by", text(&lead)), ("mark", text(STAFF_MARK))]));
        assign_order(&mut battle, run, &mut order, &order_day(today.as_ref().unwrap(), &date), None, false);
        battle.touched = true;
        battle.plan_key = String::new();
        battle.log.push(Val::obj([("d", text(&date)), ("k", text("offensive")), ("s", num(opener as f64)), ("at", text("the whole line"))]));
    }
    for side in 0..2 {
        if begun && battle.begun_by == Some(side) {
            continue;
        }
        if battle.away[side] || side_is_played(&battle, side, &players) || !staff_may_order(&battle, side) {
            continue;
        }
        if live_count(&battle.troops[side]) == 0 {
            continue;
        }
        let policy = run.staff_policy.clone();
        let asks = policy.as_ref().is_some_and(|policy| regular || policy.often());
        let led_by_own = policy.is_some() && !asks && battle.led_by_own.is_some_and(|led| led[side]);
        let answer = if any_of(&run.mech) && !led_by_own { breakthrough_answer(&battle, side) } else { None };
        let answering = battle.answering.map_or(-1.0, |answering| answering[side]);
        let idle = !battle.troops[side].iter().any(|troop| is_live(troop) && troop.order.truthy() && !troop.order.read("done").truthy() && word_is(&troop.order.read("standing").read("mark"), MIND_MARK));
        let answers = answer.is_some() && (answering < 0.0 || regular || (battle.days_run - answering >= BREAKTHROUGH_LOOK_DAYS && idle));
        if !regular && !asks && !answers {
            continue;
        }
        if today.is_none() {
            today = Some(prepare(&mut battle, day));
        }
        let began = battle_side(&battle, side) == 0;
        let key = format!("{}|{}|{}|{}", run.seed, battle.name, side, date);
        let own = match &policy {
            Some(policy) if asks => policy.decide(run, &mut battle, side, &Asked { began, today: today.as_ref().unwrap(), key: key.clone(), regular, at }),
            _ => Said::Undefined,
        };
        if let Said::Own(own) = &own {
            if let Some(air) = &own.air {
                set_air_mission(&mut battle, side, air);
            }
            if own.plan.is_some() {
                note_staff_plan(run, &mut battle, side, own, day);
            }
        }
        if asks {
            let mut led = battle.led_by_own.unwrap_or([false, false]);
            led[side] = !matches!(own, Said::Undefined);
            battle.led_by_own = Some(led);
        }
        if matches!(&own, Said::Own(own) if own.keep) {
            continue;
        }
        let lead = lead_of(&battle, side);
        let undefined = matches!(own, Said::Undefined);
        if undefined && answers {
            let answer = answer.unwrap();
            let mut book = battle.answering.unwrap_or([-1.0, -1.0]);
            book[side] = battle.days_run;
            battle.answering = Some(book);
            if answering < 0.0 {
                let place = describe_point(&battle.arena, answer.at[0], answer.at[1]);
                battle.log.push(Val::obj([("d", text(&date)), ("k", text("counter")), ("s", num(side as f64)), ("at", text(&place))]));
            }
            let bodies: Vec<MindBody> = answer.bodies.iter().map(|body| MindBody { order: body.order.to_string(), picked: body.picked.clone(), way: None }).collect();
            order_troops_by_mind(run, &mut battle, side, &bodies, day, today.as_ref().unwrap(), &lead);
            continue;
        }
        if undefined && (!regular || answer.is_some()) {
            continue;
        }
        if undefined && answering >= 0.0 {
            let mut book = battle.answering.unwrap();
            book[side] = -1.0;
            battle.answering = Some(book);
            battle.orders.retain(|order| order.read("s").num() != side as f64 || !word_is(&order.read("mark"), MIND_MARK));
        }
        let decided: Own = match own {
            Said::Own(own) => own,
            Said::Null => continue,
            Said::Undefined => {
                let Some(decided) = staff_decision(&battle, side, began, today.as_ref().map(|today| super::staff::Today { contour: &today.line.contour, count: today.line.count(), sectors: Some(&today.sectors) }).as_ref(), &key) else { continue };
                Own { order: text(decided.order), sector: text(&decided.sector), ..Own::default() }
            }
        };
        if let Some(bodies) = &decided.troops {
            order_troops_by_mind(run, &mut battle, side, bodies, day, today.as_ref().unwrap(), &lead);
            continue;
        }
        if decided.draft && !lead.is_empty() {
            give(run, at, battle);
            let said = run.notes.len();
            reinforce_on_front(run, at, &Val::obj([("side", text(&lead)), ("sector", decided.sector.clone()), ("given", Val::Bool(true))]), day);
            run.notes.truncate(said);
            battle = lend(run, at);
            today = Some(prepare(&mut battle, day));
        }
        let sector_word = js::to_string(&decided.sector);
        let wanted = format!("{}|{}", js::to_string(&decided.order), fold(&decided.sector));
        let stands = staff_standing(&battle, side);
        if stands == wanted || (word_is(&decided.order, "hold") && stands.is_empty() && !battle.orders.iter().any(|order| order.read("s").num() == side as f64 && !order.read("chosen").truthy())) {
            continue;
        }
        battle.orders.retain(|order| order.read("s").num() != side as f64 || order.read("chosen").truthy());
        let mut order = set_standing_order(&mut battle, side, &Val::obj([("sector", decided.sector.clone()), ("order", decided.order.clone()), ("since", text(&date)), ("age", num(0.0)), ("by", text(&lead)), ("mark", text(STAFF_MARK))]));
        assign_order(&mut battle, run, &mut order, &order_day(today.as_ref().unwrap(), &date), None, false);
        battle.touched = true;
        battle.plan_key = String::new();
        if word_is(&decided.order, "advance") && !stands.starts_with("advance") {
            let place = if word_is(&decided.sector, "all") { "the whole line".to_string() } else { sector_word.clone() };
            battle.log.push(Val::obj([("d", text(&date)), ("k", text("offensive")), ("s", num(side as f64)), ("at", text(&place))]));
        }
    }
    give(run, at, battle);
}

fn step_day(run: &mut Run) -> Flow<()> {
    let day = run.day + 1.0;
    let mut index = 0;
    while index < run.battles.len() {
        if run.battles[index].status == "active" {
            invade_where_sent(run, index, day)?;
            if run.battles[index].away[0] || run.battles[index].away[1] {
                come_back(run, index, day);
            }
            muster_day(run, index, day);
            dawn(run, index, day);
            let battle = &run.battles[index];
            let regular = battle.begun || battle.days_run == 0.0 || battle.days_run % STAFF_REVIEW_DAYS == 0.0;
            if regular || run.staff_policy.as_ref().is_some_and(|policy| policy.often()) || any_of(&run.mech) {
                review_staff(run, index, day, regular);
            }
            run.steps += simulate_day(run, index, day)?;
            withdraw_who_left(run, index, day);
            run.battles[index].days_run += 1.0;
        } else if run.battles[index].status == "standing" {
            if run.mech.marching() {
                peace_day(run, index, day);
            }
            stand_day(&mut run.battles[index]);
        }
        if !run.battles[index].closing.is_empty() && run.battles[index].status != "closed" {
            close_battle(run, index, day);
        }
        index += 1;
    }
    move_transports(run, day)?;
    apply_moments(run, day)?;
    let last = day >= run.days;
    for battle in run.battles.iter_mut() {
        if battle.status != "closed" && battle.recorded != day {
            record_day(battle, day, last);
        }
        if battle.status != "closed" {
            assign_commands(battle);
        }
    }
    run.day = day;
    Ok(())
}

fn named_at(run: &Run, value: &Val) -> Val {
    let at = value.get("battle");
    if let Val::Num(at) = at {
        return text(run.battles.get(*at as usize).map_or("", |battle| battle.name.as_str()));
    }
    value.get("name").clone()
}

fn with_names(run: &Run, value: &Val, key: &str) -> Val {
    let mut out = js::spread(value);
    let field = value.get(key);
    if field.is_plain_object() {
        out.set(key, named_at(run, field));
    }
    Val::Obj(out)
}

pub fn snapshot(run: &mut Run) -> Val {
    let day = run.day;
    let mut changes: Vec<Val> = Vec::new();
    let wings: Vec<Val> = wing_changes(run)
        .into_iter()
        .map(|change| match change.strength {
            Some(strength) => Val::obj([("unitId", text(&change.unit_id)), ("committedTo", text("")), ("strength", num(strength))]),
            None => Val::obj([("unitId", text(&change.unit_id)), ("committedTo", text("")), ("remove", Val::Bool(true))]),
        })
        .collect();
    for change in run.unit_changes.iter().chain(wings.iter()) {
        let mut out = Obj::new();
        for (key, value) in js::spread(change).entries() {
            if key != "committedTo" {
                out.set(key, value.clone());
            }
        }
        let committed = change.get("committedTo");
        out.set("committedTo", if let Val::Str(_) = committed { committed.clone() } else { named_at(run, committed) });
        changes.push(Val::Obj(out));
    }
    let since_first = run.date_of(0.0);
    let mut records: Vec<Val> = Vec::new();
    for at in 0..run.battles.len() {
        let mut battle = lend(run, at);
        let since = if battle.opened_day.num() > 0.0 { battle.opened_date.clone() } else { text(&since_first) };
        let brief = build_brief(&mut battle, &since);
        records.push(save_battle(&mut battle, run, day, &mut changes, &brief));
        give(run, at, battle);
    }
    let closed_of = |record: &Val| word_is(record.get("status"), "closed");
    let open: Vec<Val> = records.iter().filter(|record| !closed_of(record)).take(MAX_BATTLEFIELDS as usize).cloned().collect();
    let closed: Vec<Val> = records.iter().filter(|record| closed_of(record)).cloned().collect();
    let skip = closed.len().saturating_sub(MAX_CLOSED_BATTLEFIELDS as usize);
    let battlefields: Vec<Val> = open.into_iter().chain(closed.into_iter().skip(skip)).collect();
    let flips: Vec<Val> = run
        .flips
        .iter()
        .map(|flip| Val::obj([("day", flip.get("day").clone()), ("date", flip.get("date").clone()), ("battlefield", named_at(run, flip.get("battlefield"))), ("regionId", flip.get("regionId").clone()), ("from", flip.get("from").clone()), ("to", flip.get("to").clone()), ("kind", flip.get("kind").clone())]))
        .collect();
    let joins: Vec<Val> = run
        .joins
        .iter()
        .map(|entry| Val::obj([("day", entry.get("day").clone()), ("date", entry.get("date").clone()), ("battlefield", named_at(run, entry.get("battlefield"))), ("warId", entry.get("warId").clone()), ("name", entry.get("name").clone()), ("side", entry.get("side").clone()), ("by", entry.get("by").clone())]))
        .collect();
    let voyages: Vec<Val> = run.voyages.iter().map(|voyage| if voyage.get("battlefield").truthy() { with_names(run, voyage, "battlefield") } else { voyage.clone() }).collect();
    let notes: Vec<Val> = run.notes.iter().map(|note| with_names(run, note, "battlefield")).collect();
    let mut news: Vec<Val> = Vec::new();
    for battle in &run.battles {
        for entry in battle.log.iter().skip(battle.log_from as usize) {
            let mut told = js::spread(entry);
            told.set("battlefield", text(&battle.name));
            if word_is(entry.get("k"), "city") {
                if let Some(city) = battle.arena.cities.iter().find(|candidate| matches!(entry.get("at"), Val::Str(at) if *at == format!("city: {}", candidate.name))) {
                    told.set("size", num(jsmath::max(0.0, if city.population.is_nan() { 0.0 } else { city.population })));
                    if city.capital {
                        told.set("capital", Val::Bool(true));
                    }
                }
            }
            news.push(Val::Obj(told));
        }
    }
    let manpower: Vec<Val> = manpower_report(run).into_iter().map(|entry| Val::obj([("name", text(&entry.name)), ("drawn", num(entry.drawn)), ("returned", num(entry.returned))])).collect();
    let mut out = Obj::new();
    out.set("battlefields", Val::Arr(battlefields));
    out.set("flips", Val::Arr(flips));
    out.set("joins", Val::Arr(joins));
    out.set("starts", Val::Arr(run.starts.iter().map(|start| Val::Obj(js::spread(start))).collect()));
    out.set("unitChanges", Val::Arr(changes));
    out.set("transports", Val::Arr(run.transports.iter().map(transport_val).collect()));
    out.set("voyages", Val::Arr(voyages));
    out.set("notes", Val::Arr(notes));
    out.set("news", Val::Arr(news));
    out.set("manpower", Val::Arr(manpower));
    if run.mech.supply() {
        out.set("effort", Val::Arr(run.effort.values().map(|entry| Val::obj([("name", text(&entry.name)), ("advanced", num(entry.advanced)), ("troopDays", num(entry.troop_days)), ("warDays", num(entry.war_days))])).collect()));
    }
    if run.mech.attrition() {
        out.set("attrition", Val::Arr(attrition_report(run, day).into_iter().map(|entry| Val::obj([("name", text(&entry.name)), ("lost", num(entry.lost)), ("men", num(entry.men)), ("troopDays", num(entry.troop_days)), ("harshDays", num(entry.harsh_days)), ("days", num(entry.days))])).collect()));
    }
    let walls: Vec<Val> = lines_changed(run)
        .into_iter()
        .map(|line| Val::obj([("id", text(&line.id)), ("breaches", Val::Arr(line.breaches.iter().map(|pair| Val::nums(pair)).collect())), ("wear", Val::Arr(line.wear.iter().map(|pair| Val::nums(pair)).collect()))]))
        .collect();
    if !walls.is_empty() {
        out.set("fortifications", Val::Arr(walls));
    }
    out.set("stats", Val::obj([("days", num(day)), ("steps", num(run.steps))]));
    Val::Obj(out)
}

pub struct FrontRun {
    pub run: Run,
    pub needs_regions: bool,
}

pub fn create_front_run(input: Val, hooks: Box<dyn Hooks>) -> FrontRun {
    let input = if input.is_nullish() { Val::Obj(Obj::new()) } else { input };
    let mut run = create_run(input, hooks);
    let needs_regions = begin(&mut run).is_err();
    FrontRun { run, needs_regions }
}

impl FrontRun {
    pub fn advance(&mut self, max_days: f64) -> bool {
        if !self.needs_regions {
            let mut done = 0.0;
            while done < max_days && self.run.day < self.run.days {
                if step_day(&mut self.run).is_err() {
                    self.needs_regions = true;
                    break;
                }
                done += 1.0;
            }
        }
        self.finished()
    }

    pub fn finished(&self) -> bool {
        self.needs_regions || self.run.day >= self.run.days
    }

    pub fn snapshot(&mut self) -> Val {
        if self.needs_regions {
            Val::obj([("needsRegions", Val::Bool(true))])
        } else {
            snapshot(&mut self.run)
        }
    }

    pub fn finish(&mut self) -> Val {
        self.advance(f64::INFINITY);
        self.snapshot()
    }
}

pub fn run_fronts(input: Val, hooks: Box<dyn Hooks>) -> Val {
    create_front_run(input, hooks).finish()
}

pub fn set_air_mission(battle: &mut Battle, side: usize, mission: &str) {
    if !super::air::AIR_MISSIONS.contains(&mission) {
        return;
    }
    for other in 0..2 {
        if battle.air_mission[other].is_empty() {
            battle.air_mission[other] = "support".to_string();
        }
    }
    battle.air_mission[side] = mission.to_string();
}

fn note_staff_plan(run: &Run, battle: &mut Battle, side: usize, said: &Own, day: f64) {
    let aim = said.aim.as_ref().filter(|aim| aim.len() == 2).map(|aim| battle.place.to_cell(aim[0], aim[1]));
    let at = match aim {
        Some([x, y]) if x.is_finite() && y.is_finite() => describe_point(&battle.arena, x, y),
        _ => String::new(),
    };
    let mut sent = 0.0;
    for body in said.troops.iter().flatten() {
        if body.order == "advance" {
            sent += body.picked.len() as f64;
        }
    }
    if battle.staff_plans.as_array().is_none() {
        battle.staff_plans = Val::Arr(vec![Val::Null, Val::Null]);
    }
    let mut plan = Obj::new();
    plan.set("plan", text(said.plan.as_deref().unwrap_or("")));
    if !at.is_empty() {
        plan.set("at", text(&at));
    }
    plan.set("since", text(&run.date_of(day)));
    plan.set("n", num(sent));
    if let Val::Arr(list) = &mut battle.staff_plans {
        while list.len() <= side {
            list.push(Val::Undef);
        }
        list[side] = Val::Obj(plan);
    }
}

pub fn rehearsal_copy(battle: &mut Battle) -> Battle {
    let recorder = battle.recorder.take();
    let mut copy = battle.clone();
    battle.recorder = recorder;
    let mut seen = js::Fresh::default();
    copy.orders = copy.orders.iter().map(|order| order.fresh(&mut seen)).collect();
    copy.halts = copy.halts.iter().map(|halt| halt.fresh(&mut seen)).collect();
    for views in copy.views.iter_mut() {
        for view in views.iter_mut() {
            view.order = view.order.fresh(&mut seen);
            view.word = view.word.fresh(&mut seen);
            view.age = view.age.fresh(&mut seen);
        }
    }
    for troops in copy.troops.iter_mut() {
        for troop in troops.iter_mut() {
            troop.order = troop.order.fresh(&mut seen);
            troop.fallback = troop.fallback.fresh(&mut seen);
            troop.entry = troop.entry.fresh(&mut seen);
            troop.still = troop.still.fresh(&mut seen);
        }
    }
    copy.plans = copy.plans.fresh(&mut seen);
    copy.sieges = copy.sieges.iter().map(|siege| siege.fresh(&mut seen)).collect();
    copy.anchors = copy.anchors.iter().map(|anchor| anchor.fresh(&mut seen)).collect();
    copy.watch = false;
    copy.mend_of = false;
    copy.grown = 6.0;
    copy
}

pub fn rehearsal(run: &Run, battle: &mut Battle) -> Run {
    let copy = rehearsal_copy(battle);
    run.stub(copy)
}

pub fn rehearse_orders(stub: &mut Run, side: usize, bodies: &[Body], day: f64, air: Option<&str>) {
    let mut battle = lend(stub, 0);
    if let Some(air) = air {
        set_air_mission(&mut battle, side, air);
    }
    if !bodies.is_empty() && live_count(&battle.troops[side]) > 0 {
        let today = prepare(&mut battle, day);
        let lead = lead_of(&battle, side);
        order_troops_by_mind(stub, &mut battle, side, bodies, day, &today, &lead);
    }
    give(stub, 0, battle);
}

pub fn rehearse_day(stub: &mut Run, day: f64, morning: bool) -> bool {
    if stub.battles[0].status != "active" || !stub.battles[0].closing.is_empty() {
        return false;
    }
    if morning {
        muster_day(stub, 0, day);
        dawn(stub, 0, day);
    }
    let steps = simulate_day(stub, 0, day).unwrap_or(0.0);
    stub.steps += steps;
    stub.battles[0].days_run += 1.0;
    stub.battles[0].closing.is_empty()
}

pub fn create_front_run_led(input: Val, hooks: Box<dyn Hooks>, policy: Option<Rc<dyn StaffHook>>) -> FrontRun {
    let input = if input.is_nullish() { Val::Obj(Obj::new()) } else { input };
    let mut run = create_run(input, hooks);
    run.staff_policy = policy;
    let needs_regions = begin(&mut run).is_err();
    FrontRun { run, needs_regions }
}

#[derive(Default)]
pub struct Kept {
    pub arenas: HashMap<String, Rc<Arena>>,
    pub grids: HashMap<String, WorldGrid>,
    pub flags: HashSet<String>,
    pub lists: HashMap<String, Val>,
}

pub fn create_front_run_kept(input: Val, hooks: Box<dyn Hooks>, policy: Option<Rc<dyn StaffHook>>, kept: Kept) -> FrontRun {
    let input = if input.is_nullish() { Val::Obj(Obj::new()) } else { input };
    let mut run = create_run(input, hooks);
    run.staff_policy = policy;
    if run.cache_on {
        for (key, arena) in kept.arenas {
            run.arenas.entry(key).or_insert(arena);
        }
        for (key, grid) in kept.grids {
            run.grids.entry(key).or_insert(grid);
        }
        run.kept_flags.extend(kept.flags);
        for (key, list) in kept.lists {
            run.kept_lists.entry(key).or_insert(list);
        }
    }
    let needs_regions = begin(&mut run).is_err();
    FrontRun { run, needs_regions }
}

impl FrontRun {
    pub fn take_kept(&mut self) -> Option<Kept> {
        if !self.run.cache_on {
            return None;
        }
        let mut grids = std::mem::take(&mut self.run.grids);
        grids.remove(OWN_GRID);
        Some(Kept { arenas: std::mem::take(&mut self.run.arenas), grids, flags: std::mem::take(&mut self.run.kept_flags), lists: std::mem::take(&mut self.run.kept_lists) })
    }
}
