use super::codec::decode_troops;
use super::command::{generals_of, name_generals, order_troops, own_troops_of, read_talk, release_troops, return_troops, talk_val, with_talk, OrderAsk};
use super::constants::*;
use super::deploy::{with_deploy_line, DEPLOY_USUAL};
use super::frame::{point_in_frame, Projector};
use super::game_dates::game_date_year;
use super::js::{self, Obj, Val};
use super::plans::{same_val, with_diversion, with_project_plan, without_plan};
use super::record::{battlefield_side_of, fold_battlefield_name, frame_from, is_open_battlefield, normalize_battlefield};
use super::swarms::{DEPLOY_FORMS, SWARM_FORM};
use super::transports::{cancel_transport, hunt_transport, is_under_way, normalize_transports, order_transport, transport_bar, transport_load_most, transport_val, Transport, TRANSPORT_LOAD_MOST, TRANSPORT_MEDIA};
use super::unit_motion::year_in_era;
use crate::jsmath;

pub const WAR_ROOM_OPS: [&str; 13] = ["order", "route", "release", "return", "talk", "forget", "diversion", "plan", "unplan", "transport", "untransport", "hunt", "deploy"];
const TRANSPORT_OPS: [&str; 3] = ["transport", "untransport", "hunt"];
pub const WAR_ROOM_WAY_MOST: usize = 400;

pub const REFUSED_NOTHING: &str = "Nothing was asked.";
pub const REFUSED_CLOSED: &str = "That battlefield is no longer open.";
pub const REFUSED_SIDE: &str = "Your troops are not on that battlefield.";
pub const REFUSED_TROOPS: &str = "None of those troops are yours to order.";
pub const REFUSED_ORDER: &str = "The generals do not know that order.";
pub const REFUSED_WAY: &str = "That way does not cross the battlefield.";
pub const REFUSED_ROOM: &str = "There is no room for another order there: release some troops first.";
pub const REFUSED_PLANS: &str = "There is no room for another plan there: take one off first.";
pub const REFUSED_CARRIER: &str = "Nothing of that kind carries troops yet.";
pub const REFUSED_SWITCHED_OFF: &str = "This game carries no troops that way.";
pub const REFUSED_NO_NAVY: &str = "You have no navy to carry troops by sea.";
pub const REFUSED_NO_AIR_FORCE: &str = "You have no air force to carry troops by air.";
pub const REFUSED_PLACE: &str = "Say where they are to be taken.";
pub const REFUSED_ABOARD: &str = "Those troops are already told to board a transporter.";
pub const REFUSED_TRANSPORTS: &str = "Too many transporters are out already: wait for one to arrive.";
pub const REFUSED_GONE: &str = "That transporter has set out already, or is not yours to call off.";
pub const REFUSED_QUARRY: &str = "That is not a transporter of a side you are fighting here.";
pub const REFUSED_AWAY: &str = "Your troops have not withdrawn from that battlefield.";
pub const REFUSED_HOME: &str = "Your forces at home have no front to go forward from: draw them a route.";
const HOME_ORDERS_REFUSED: [&str; 6] = ["advance", "blitz", "spearhead", "flank", "encircle", "fall back"];

fn clean(value: &Val, most: usize) -> String {
    let text = js::trim(&js::collapse_spaces(&value.string_or_empty())).to_string();
    js::trim(&js::slice_units(&text, 0, most)).to_string()
}

fn fold_name(value: &Val) -> String {
    clean(value, 200).to_lowercase()
}

fn text(value: &str) -> Val {
    Val::Str(value.to_string())
}

fn num(value: f64) -> Val {
    Val::Num(value)
}

fn list(value: &Val) -> &[Val] {
    value.array_or_empty()
}

fn rounded(value: f64) -> f64 {
    jsmath::round(value * 10000.0) / 10000.0
}

fn way_on(record: &Val, value: &Val) -> Vec<[f64; 2]> {
    let mut drawn: Vec<[f64; 2]> = Vec::new();
    for point in list(value) {
        let lng = js::to_number(&point.element(0));
        let lat = js::to_number(&point.element(1));
        if lng.is_finite() && lat.is_finite() {
            drawn.push([lng, lat]);
        }
        if drawn.len() >= WAR_ROOM_WAY_MOST * 25 {
            break;
        }
    }
    let frame = frame_from(record.get("frame"));
    let place = Projector::of(&frame);
    let (cols, rows) = (frame.cols, frame.rows);
    let near: Vec<[f64; 2]> = drawn
        .into_iter()
        .filter(|&[lng, lat]| {
            let [x, y] = place.to_cell(lng, lat);
            x >= -cols / 2.0 && x <= cols * 1.5 && y >= -rows / 2.0 && y <= rows * 1.5
        })
        .collect();
    if !near.iter().any(|&[lng, lat]| point_in_frame(&frame, lng, lat)) {
        return Vec::new();
    }
    if near.len() <= WAR_ROOM_WAY_MOST {
        return near;
    }
    (0..WAR_ROOM_WAY_MOST).map(|index| near[jsmath::round((index as f64 * (near.len() as f64 - 1.0)) / (WAR_ROOM_WAY_MOST as f64 - 1.0)) as usize]).collect()
}

fn way_val(way: &[[f64; 2]]) -> Val {
    Val::Arr(way.iter().map(|point| Val::nums(point)).collect())
}

fn troop_indexes(value: &Val) -> Vec<usize> {
    let mut out: Vec<usize> = Vec::new();
    for item in list(value) {
        let index = js::to_number(item);
        if index.is_finite() && index.trunc() == index && index >= 0.0 && index < MAX_TROOPS_PER_SIDE {
            let index = index as usize;
            if !out.contains(&index) {
                out.push(index);
            }
        }
    }
    out
}

fn own_indexes(record: &Val, side: usize, player: &str, value: &Val) -> Vec<usize> {
    let own = own_troops_of(record, &num(side as f64), &text(player));
    troop_indexes(value).into_iter().filter(|index| own.contains(index)).collect()
}

fn indexes_val(indexes: &[usize]) -> Val {
    Val::Arr(indexes.iter().map(|&index| num(index as f64)).collect())
}

fn transports_val(transports: &[Transport]) -> Val {
    Val::Arr(transports.iter().map(transport_val).collect())
}

pub enum Applied {
    Error(&'static str),
    Battlefields { battlefields: Vec<Val>, record: Val, side: usize, transports: Option<Val> },
}

fn apply_transport_op(record: &Val, side: usize, op: &Val, player: &str, date: &Val, transports: &Val, era: Option<f64>, media: Option<&[String]>, military: &Val) -> Result<Val, &'static str> {
    let kept = normalize_transports(transports);
    let kept_val = transports_val(&kept);
    let op_name = op.get("op").string_or_empty();
    let player_val = text(player);
    if op_name == "untransport" {
        let id = clean(op.get("id"), 24);
        let mine = kept.iter().find(|entry| entry.id == id && entry.status == "ordered" && [&entry.by, &entry.owner].iter().any(|name| fold_name(&text(name)) == fold_name(&player_val)));
        return match mine {
            Some(mine) => Ok(transports_val(&cancel_transport(&kept_val, &text(&mine.id)))),
            None => Err(REFUSED_GONE),
        };
    }
    if op_name == "hunt" {
        let id = clean(op.get("id"), 24);
        let theirs = kept.iter().find(|entry| entry.id == id && is_under_way(entry) && list(record.get("sides").at(1 - side)).iter().any(|member| fold_name(member) == fold_name(&text(&entry.owner))));
        return match theirs {
            Some(theirs) => Ok(transports_val(&hunt_transport(&kept_val, &text(&theirs.id), &player_val, !op.get("off").is_true()))),
            None => Err(REFUSED_QUARRY),
        };
    }
    let medium = match op.get("medium") {
        Val::Str(medium) if TRANSPORT_MEDIA.contains(&medium.as_str()) => medium.clone(),
        _ => String::new(),
    };
    let to = op.get("to");
    let lng = js::to_number(&to.element(0));
    let lat = js::to_number(&to.element(1));
    if medium.is_empty() {
        return Err(REFUSED_CARRIER);
    }
    match transport_bar(&medium, media, military) {
        "switched-off" => return Err(REFUSED_SWITCHED_OFF),
        "no-navy" => return Err(REFUSED_NO_NAVY),
        "no-air-force" => return Err(REFUSED_NO_AIR_FORCE),
        _ => {}
    }
    if to.as_array().is_none() || !lng.is_finite() || !lat.is_finite() || lat.abs() > 90.0 {
        return Err(REFUSED_PLACE);
    }
    let standing = decode_troops(&record.get("troops").at(side).string_or_empty());
    let name = fold_battlefield_name(record.get("name"));
    let boarding: Vec<f64> = kept
        .iter()
        .filter(|entry| entry.status == "ordered")
        .filter_map(|entry| entry.embark.as_ref())
        .filter(|embark| embark.side == side as f64 && fold_battlefield_name(&text(&embark.battlefield)) == name)
        .flat_map(|embark| embark.troops.clone())
        .collect();
    let asked: Vec<usize> = own_indexes(record, side, player, op.get("troops")).into_iter().filter(|&index| standing.get(index).is_some_and(|troop| troop.strength > 0.0)).collect();
    if asked.is_empty() {
        return Err(REFUSED_TROOPS);
    }
    let year = match game_date_year(&date.string_or_empty()) {
        Some(year) => Some(year_in_era(year, era)),
        None => Some(year_in_era(f64::NAN, era)).filter(|year| !year.is_nan()),
    };
    let carries = jsmath::max(1.0, jsmath::min(TRANSPORT_LOAD_MOST, transport_load_most(&medium, year, military)));
    let troops: Vec<usize> = asked.into_iter().filter(|&index| !boarding.contains(&(index as f64))).take(carries as usize).collect();
    if troops.is_empty() {
        return Err(REFUSED_ABOARD);
    }
    let spec = Val::obj([
        ("medium", text(&medium)),
        ("owner", player_val.clone()),
        ("warId", record.get("warId").clone()),
        ("to", Val::obj([("lng", num(lng)), ("lat", num(lat)), ("name", text(&clean(op.get("name"), 120)))])),
        ("embark", Val::obj([("battlefield", record.get("name").clone()), ("side", num(side as f64)), ("troops", indexes_val(&troops))])),
        ("by", player_val.clone()),
    ]);
    match order_transport(&kept_val, &spec, &clean(date, 40), year) {
        Ok(sent) => Ok(transports_val(&sent.transports)),
        Err("not-yet") => Err(REFUSED_CARRIER),
        Err("too-many") => Err(REFUSED_TRANSPORTS),
        Err(_) => Err(REFUSED_NOTHING),
    }
}

fn changed(next: &Val, record: &Val) -> bool {
    !same_val(next, record)
}

fn ask_order(record: &Val, side: usize, troops: &Val, order: &Val, objective: &Val, way: &Val, by: &str, since: &str) -> Val {
    order_troops(record, &OrderAsk { side: &num(side as f64), troops, order, objective, way, by: &text(by), since: &text(since), mark: &text("") })
}

fn apply_to(record: &Val, side: usize, op: &Val, player: &str, date: &Val) -> Result<Val, &'static str> {
    let since = clean(date, 40);
    let side_val = num(side as f64);
    let op_name = op.get("op").string_or_empty();
    match op_name.as_str() {
        "order" => {
            let order = clean(op.get("order"), 20).to_lowercase();
            if !WAR_ROOM_ORDERS.contains(&order.as_str()) {
                return Err(REFUSED_ORDER);
            }
            let troops = own_indexes(record, side, player, op.get("troops"));
            let next = ask_order(record, side, &indexes_val(&troops), &text(&order), &text(&clean(op.get("objective"), 120)), &Val::Null, player, &since);
            if !changed(&next, record) {
                return Err(if troops.is_empty() { REFUSED_TROOPS } else { REFUSED_ROOM });
            }
            Ok(next)
        }
        "route" => {
            let way = way_on(record, op.get("way"));
            if way.len() < 2 {
                return Err(REFUSED_WAY);
            }
            let troops = own_indexes(record, side, player, op.get("troops"));
            let next = ask_order(record, side, &indexes_val(&troops), &text("advance"), &text(""), &way_val(&way), player, &since);
            if !changed(&next, record) {
                return Err(if troops.is_empty() { REFUSED_TROOPS } else { REFUSED_ROOM });
            }
            Ok(next)
        }
        "release" => Ok(release_troops(record, &side_val, &indexes_val(&own_indexes(record, side, player, op.get("troops"))))),
        "return" => {
            let next = return_troops(record, &side_val, &text(player), &text(&since));
            if changed(&next, record) {
                Ok(next)
            } else {
                Err(REFUSED_AWAY)
            }
        }
        "talk" => {
            let generals = generals_of(record, &side_val, &text(player));
            let commands: Vec<f64> = generals.iter().map(|general| general.command).collect();
            let said = clean(op.get("said"), TALK_TEXT_MAX as usize);
            let mut lines: Vec<Val> = Vec::new();
            if !said.is_empty() {
                lines.push(Val::obj([("who", text("")), ("text", text(&said)), ("at", text(&since))]));
            }
            for line in list(op.get("lines")).iter().take(6) {
                let who = js::to_number(line.get("who"));
                let spoken = js::slice_units(js::trim(&line.get("text").string_or_empty()), 0, TALK_TEXT_MAX as usize);
                if !spoken.is_empty() && who.is_finite() && who.trunc() == who && commands.contains(&who) {
                    lines.push(Val::obj([("who", num(who)), ("text", text(&spoken)), ("at", text(&since))]));
                }
            }
            if lines.is_empty() {
                return Err(REFUSED_NOTHING);
            }
            let mut next = with_talk(record, &side_val, &Val::Arr(lines));
            let names: Vec<String> = list(op.get("names")).iter().take(MAX_COMMANDS as usize).map(|name| clean(name, 80)).collect();
            if names.iter().any(|name| !name.is_empty()) {
                next = name_generals(&next, &side_val, &Val::Arr(names.iter().map(|name| text(name)).collect()), false);
            }
            let mut told: Vec<f64> = Vec::new();
            for entry in list(op.get("orders")).iter().take(MAX_COMMANDS as usize) {
                let command = js::to_number(entry.get("command"));
                let order = clean(entry.get("order"), 20).to_lowercase();
                if !commands.contains(&command) || told.contains(&command) || !WAR_ROOM_ORDERS.contains(&order.as_str()) {
                    continue;
                }
                told.push(command);
                let Some(general) = generals_of(&next, &side_val, &text("")).into_iter().find(|one| one.command == command) else { continue };
                next = ask_order(&next, side, &indexes_val(&general.troops), &text(&order), &text(&clean(entry.get("objective"), 120)), &Val::Null, player, &since);
            }
            Ok(next)
        }
        "forget" => {
            let mut talk = read_talk(record.get("brief").get("carry").get("talk"));
            talk[side] = Vec::new();
            let carry_given = record.get("brief").get("carry");
            let mut carry = if carry_given.is_nullish() { Obj::new() } else { js::spread(carry_given) };
            carry.set("talk", Val::Arr(talk.iter().map(|lines| Val::Arr(lines.iter().map(talk_val).collect())).collect()));
            let mut brief = js::spread(record.get("brief"));
            brief.set("carry", Val::Obj(carry));
            let mut out = js::spread(record);
            out.set("brief", Val::Obj(brief));
            Ok(Val::Obj(out))
        }
        "diversion" => {
            let way = way_on(record, op.get("way"));
            if way.len() < 2 {
                return Err(REFUSED_WAY);
            }
            let troops = jsmath::max(0.0, jsmath::min(MAX_TROOPS_PER_SIDE, jsmath::round(js::or_zero(js::to_number(op.get("troops"))))));
            let next = with_diversion(record, &side_val, &way_val(&way), &num(troops), &text(&since));
            if changed(&next, record) {
                Ok(next)
            } else {
                Err(REFUSED_PLANS)
            }
        }
        "plan" => {
            let project = clean(op.get("project"), 160);
            if project.is_empty() {
                return Err(REFUSED_NOTHING);
            }
            let mut way = Val::Null;
            if let Val::Arr(drawn) = op.get("way") {
                let read = way_on(record, op.get("way"));
                if !drawn.is_empty() && read.len() < 2 {
                    return Err(REFUSED_WAY);
                }
                way = way_val(&read);
            }
            let off = match op.get("off") {
                Val::Bool(flag) => Val::Bool(*flag),
                _ => Val::Null,
            };
            let sent = if op.get("again").is_true() { Val::Bool(false) } else { Val::Null };
            Ok(with_project_plan(record, &side_val, &text(&project), &way, &off, &sent, &text(&since)))
        }
        "unplan" => Ok(without_plan(record, &side_val, &text(&clean(op.get("id"), 180)))),
        "deploy" => {
            let form = if matches!(op.get("form"), Val::Str(form) if form == SWARM_FORM) { SWARM_FORM } else { "" };
            let drawn = list(op.get("way"));
            let way = if !drawn.is_empty() { way_on(record, &Val::Arr(if form.is_empty() { drawn.to_vec() } else { drawn[..1].to_vec() })) } else { Vec::new() };
            if !drawn.is_empty() && way.len() < if form.is_empty() { 2 } else { 1 } {
                return Err(REFUSED_WAY);
            }
            let count = match op.get("count") {
                Val::Undef | Val::Null => text(DEPLOY_USUAL),
                Val::Str(given) if given.is_empty() => text(DEPLOY_USUAL),
                other if js::to_number(other) == 0.0 => num(0.0),
                _ => text(DEPLOY_USUAL),
            };
            Ok(with_deploy_line(record, &side_val, &text(player), &way_val(&way), &text(form), &count))
        }
        _ => Err(REFUSED_NOTHING),
    }
}

pub fn deploy_battlefield_of(battlefields: &Val, op: &Val, player: &Val) -> String {
    let named = clean(op.get("battlefield"), 120);
    let drawn = list(op.get("way"));
    if !matches!(op.get("op"), Val::Str(name) if name == "deploy") || drawn.is_empty() {
        return named;
    }
    let swarm = matches!(op.get("form"), Val::Str(form) if form == SWARM_FORM);
    let least = if swarm { 1 } else { 2 };
    let first = Val::Arr(drawn.iter().take(1).cloned().collect());
    let all = Val::Arr(drawn.to_vec());
    let used = if swarm { &first } else { &all };
    let rows: Vec<Option<Val>> = list(battlefields).iter().map(|row| if row.truthy() { normalize_battlefield(row) } else { None }).collect();
    let wanted = fold_battlefield_name(&text(&named));
    let Some(record_at) = rows.iter().position(|row| row.as_ref().is_some_and(|row| fold_battlefield_name(row.get("name")) == wanted)) else { return named };
    let record = rows[record_at].as_ref().unwrap();
    if !record.get("frame").truthy() || !record.get("warId").truthy() || way_on(record, used).len() >= least {
        return named;
    }
    let mut best: Option<usize> = None;
    let mut most = 0;
    for (at, row) in rows.iter().enumerate() {
        let Some(row) = row else { continue };
        if !row.get("frame").truthy() || at == record_at || row.get("home").is_true() || !js::strict_equals(row.get("warId"), record.get("warId")) || !is_open_battlefield(row) {
            continue;
        }
        let side = battlefield_side_of(row, player);
        if side != HOLDER_SIDE_A as f64 && side != HOLDER_SIDE_B as f64 {
            continue;
        }
        if way_on(row, used).len() < least {
            continue;
        }
        let frame = frame_from(row.get("frame"));
        let inside = drawn.iter().filter(|point| point_in_frame(&frame, js::to_number(&point.element(0)), js::to_number(&point.element(1)))).count();
        if inside > most {
            best = Some(at);
            most = inside;
        }
    }
    match best {
        Some(at) => rows[at].as_ref().unwrap().get("name").string_or_empty(),
        None => named,
    }
}

pub fn apply_war_room_op(battlefields: &Val, op: &Val, player: &Val, date: &Val, transports: &Val, era: Option<f64>, media: Option<&[String]>, military: &Val) -> Applied {
    if !op.truthy() || !matches!(op.get("op"), Val::Str(name) if WAR_ROOM_OPS.contains(&name.as_str())) {
        return Applied::Error(REFUSED_NOTHING);
    }
    let wanted = if matches!(op.get("op"), Val::Str(name) if name == "deploy") { fold_battlefield_name(&text(&deploy_battlefield_of(battlefields, op, player))) } else { fold_battlefield_name(op.get("battlefield")) };
    let rows = list(battlefields).to_vec();
    let at = rows.iter().position(|row| fold_battlefield_name(row.get("name")) == wanted && !wanted.is_empty());
    let record = at.and_then(|at| normalize_battlefield(&rows[at]));
    let Some(record) = record.filter(|record| is_open_battlefield(record) || matches!(record.get("status"), Val::Str(status) if status == "standing")) else { return Applied::Error(REFUSED_CLOSED) };
    let at = at.unwrap();
    let player = clean(player, 120);
    let side = battlefield_side_of(&record, &text(&player));
    if side != HOLDER_SIDE_A as f64 && side != HOLDER_SIDE_B as f64 {
        return Applied::Error(REFUSED_SIDE);
    }
    let side = side as usize;
    let op_name = op.get("op").string_or_empty();
    if record.get("home").is_true() && (op_name == "diversion" || (op_name == "order" && matches!(op.get("order"), Val::Str(order) if HOME_ORDERS_REFUSED.contains(&order.as_str())))) {
        return Applied::Error(REFUSED_HOME);
    }
    if TRANSPORT_OPS.contains(&op_name.as_str()) {
        return match apply_transport_op(&record, side, op, &player, date, transports, era, media, military) {
            Ok(transports) => Applied::Battlefields { battlefields: rows, record, side, transports: Some(transports) },
            Err(error) => Applied::Error(error),
        };
    }
    match apply_to(&record, side, op, &player, date) {
        Ok(next) => {
            let mut rows = rows;
            rows[at] = next.clone();
            Applied::Battlefields { battlefields: rows, record: next, side, transports: None }
        }
        Err(error) => Applied::Error(error),
    }
}

pub fn clean_war_room_op(op: &Val) -> Val {
    if !op.truthy() || !matches!(op.get("op"), Val::Str(name) if WAR_ROOM_OPS.contains(&name.as_str())) {
        return Val::Null;
    }
    let mut sent = Obj::new();
    sent.set("op", op.get("op").clone());
    sent.set("battlefield", text(&clean(op.get("battlefield"), 120)));
    let given = |key: &str| !op.get(key).is_undef();
    if given("troops") {
        sent.set("troops", indexes_val(&troop_indexes(op.get("troops"))));
    }
    if given("order") {
        sent.set("order", text(&clean(op.get("order"), 20).to_lowercase()));
    }
    if given("objective") {
        sent.set("objective", text(&clean(op.get("objective"), 120)));
    }
    if given("way") {
        let mut way: Vec<[f64; 2]> = list(op.get("way"))
            .iter()
            .take(WAR_ROOM_WAY_MOST * 25)
            .map(|point| [rounded(js::to_number(&point.element(0))), rounded(js::to_number(&point.element(1)))])
            .filter(|[lng, lat]| lng.is_finite() && lat.is_finite())
            .collect();
        if way.len() as f64 > MAX_WAY_POINTS * 8.0 {
            let every = (way.len() as f64 / (MAX_WAY_POINTS * 8.0)).ceil() as usize;
            let last = way.len() - 1;
            way = way.into_iter().enumerate().filter(|(index, _)| index % every == 0 || *index == last).map(|(_, point)| point).collect();
        }
        sent.set("way", way_val(&way));
    }
    if given("said") {
        sent.set("said", text(&clean(op.get("said"), TALK_TEXT_MAX as usize)));
    }
    if given("lines") {
        sent.set("lines", Val::Arr(list(op.get("lines")).iter().take(6).map(|line| Val::obj([("who", num(js::to_number(line.get("who")))), ("text", text(&js::slice_units(js::trim(&line.get("text").string_or_empty()), 0, TALK_TEXT_MAX as usize)))])).collect()));
    }
    if given("orders") {
        sent.set(
            "orders",
            Val::Arr(
                list(op.get("orders"))
                    .iter()
                    .take(MAX_COMMANDS as usize)
                    .map(|entry| Val::obj([("command", num(js::to_number(entry.get("command")))), ("order", text(&clean(entry.get("order"), 20).to_lowercase())), ("objective", text(&clean(entry.get("objective"), 120)))]))
                    .collect(),
            ),
        );
    }
    if given("names") {
        sent.set("names", Val::Arr(list(op.get("names")).iter().take(MAX_COMMANDS as usize).map(|name| text(&clean(name, 80))).collect()));
    }
    if given("project") {
        sent.set("project", text(&clean(op.get("project"), 160)));
    }
    if let Val::Bool(off) = op.get("off") {
        sent.set("off", Val::Bool(*off));
    }
    if op.get("again").is_true() {
        sent.set("again", Val::Bool(true));
    }
    if given("id") {
        sent.set("id", text(&clean(op.get("id"), 180)));
    }
    if given("medium") {
        sent.set("medium", match op.get("medium") {
            Val::Str(medium) if TRANSPORT_MEDIA.contains(&medium.as_str()) => text(medium),
            _ => text(""),
        });
    }
    if given("form") {
        sent.set("form", match op.get("form") {
            Val::Str(form) if DEPLOY_FORMS.contains(&form.as_str()) => text(form),
            _ => text(""),
        });
    }
    let count = op.get("count");
    if !count.is_nullish() && !matches!(count, Val::Str(given) if given.is_empty()) && js::to_number(count) == 0.0 {
        sent.set("count", num(0.0));
    }
    if given("to") {
        let to = op.get("to");
        let at = |index: usize| match to {
            Val::Undef | Val::Null => f64::NAN,
            other => js::to_number(&other.element(index)),
        };
        sent.set("to", Val::nums(&[rounded(at(0)), rounded(at(1))]));
    }
    if given("name") {
        sent.set("name", text(&clean(op.get("name"), 120)));
    }
    Val::Obj(sent)
}
