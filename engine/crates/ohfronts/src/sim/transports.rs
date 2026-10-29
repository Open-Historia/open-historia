use super::constants::BATTLEFIELD_NAME_MAX;
use super::engine::clean;
use super::js::{self, Obj, OrdMap, Val};
use super::unit_motion::hash_seed;
use super::wayfinder::{find_way, Ask, Way, MEDIA, WAY_POINTS_MOST};
use super::world_grid::{km_between, place_along, Surface, WorldGrid};
use crate::jsmath;

pub const TRANSPORT_MEDIA: [&str; 3] = MEDIA;
pub const TRANSPORT_ORDERS: [(&str, &str); 3] = [("ship", "sea"), ("rail", "land"), ("airlift", "air")];
pub const TRANSPORT_LOAD_USUAL: f64 = 8.0;
pub const TRANSPORT_STATUSES: [&str; 6] = ["ordered", "moving", "landed", "lost", "refused", "returned"];
pub const TRANSPORT_ENDED: [&str; 4] = ["landed", "lost", "refused", "returned"];
pub const MAX_TRANSPORTS: usize = 24;
pub const TRANSPORT_LOAD_MOST: f64 = 40.0;
pub const TRANSPORT_HUNTERS_MOST: usize = 6;
pub const TRANSPORT_CAPACITY: [f64; 2] = [1.0, 12.0];

pub fn transport_speed_km(medium: &str) -> [f64; 2] {
    match medium {
        "sea" => [40.0, 1400.0],
        "land" => [15.0, 1600.0],
        _ => [300.0, 22000.0],
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Carrier {
    pub since: f64,
    pub kind: &'static str,
    pub speed: f64,
    pub capacity: f64,
}

const fn carrier(since: f64, kind: &'static str, speed: f64, capacity: f64) -> Carrier {
    Carrier { since, kind, speed, capacity }
}

pub const CARRIERS_SEA: [Carrier; 3] = [carrier(1940.0, "troop convoy", 720.0, 6.0), carrier(1850.0, "troopships", 480.0, 5.0), carrier(f64::NEG_INFINITY, "transport fleet", 190.0, 3.0)];
pub const CARRIERS_LAND: [Carrier; 3] = [carrier(1920.0, "troop trains", 800.0, 4.0), carrier(1840.0, "troop trains", 480.0, 4.0), carrier(f64::NEG_INFINITY, "wagon train", 35.0, 2.0)];
pub const CARRIERS_AIR: [Carrier; 2] = [carrier(1960.0, "transport aircraft", 15000.0, 2.0), carrier(1936.0, "transport aircraft", 5500.0, 1.0)];

fn fold(value: &Val) -> String {
    clean(value, 120).to_lowercase()
}

fn clamp(value: f64, least: f64, most: f64) -> f64 {
    jsmath::min(most, jsmath::max(least, value))
}

fn round3(value: f64) -> f64 {
    jsmath::round(value * 1000.0) / 1000.0
}

pub fn carrier_for(medium: &str, year: Option<f64>) -> Option<Carrier> {
    let rows: &[Carrier] = match medium {
        "sea" => &CARRIERS_SEA,
        "land" => &CARRIERS_LAND,
        "air" => &CARRIERS_AIR,
        _ => return None,
    };
    let when = match year {
        Some(year) if year.is_finite() => year,
        _ => 2000.0,
    };
    rows.iter().find(|row| when >= row.since).copied()
}

#[derive(Clone, Debug, PartialEq)]
pub struct Place {
    pub lng: Option<f64>,
    pub lat: Option<f64>,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Embark {
    pub battlefield: String,
    pub side: f64,
    pub troops: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Transport {
    pub id: String,
    pub medium: String,
    pub kind: String,
    pub owner: String,
    pub war_id: String,
    pub battlefield: String,
    pub from: Option<Place>,
    pub to: Place,
    pub speed: f64,
    pub capacity: f64,
    pub load: Vec<[f64; 2]>,
    pub status: String,
    pub ordered: String,
    pub departed: String,
    pub due: String,
    pub ended: String,
    pub way: Vec<[f64; 2]>,
    pub km: f64,
    pub gone: f64,
    pub at: Option<[f64; 2]>,
    pub landing: Option<[f64; 2]>,
    pub hunters: Vec<String>,
    pub hits: f64,
    pub sunk: f64,
    pub by: String,
    pub note: String,
    pub attacks: Option<Vec<String>>,
    pub raise: Option<f64>,
    pub embark: Option<Embark>,
}

fn number_of(value: &Val) -> f64 {
    match value {
        Val::Undef | Val::Null => f64::NAN,
        Val::Str(text) if text.is_empty() => f64::NAN,
        other => js::to_number(other),
    }
}

pub fn read_point(value: &Val) -> Option<[f64; 2]> {
    let (lng, lat) = match value {
        Val::Arr(_) => (number_of(&value.element(0)), number_of(&value.element(1))),
        _ => (number_of(value.get("lng")), number_of(value.get("lat"))),
    };
    if lng.is_finite() && lat.is_finite() && lat.abs() <= 90.0 {
        Some([round3(lng), round3(lat)])
    } else {
        None
    }
}

fn read_place(value: &Val) -> Option<Place> {
    read_point(value).map(|[lng, lat]| Place { lng: Some(lng), lat: Some(lat), name: clean(value.get("name"), 120) })
}

fn read_load(value: &Val) -> Vec<[f64; 2]> {
    let mut load = Vec::new();
    for entry in value.array_or_empty() {
        let pick = |at: usize, key: &str| if matches!(entry, Val::Arr(_)) { entry.element(at) } else { entry.get(key).clone() };
        let strength = jsmath::round(js::to_number(&pick(0, "strength")));
        let kind = jsmath::round(js::to_number(&pick(1, "kind")));
        if !(strength > 0.0) {
            continue;
        }
        load.push([clamp(strength, 1.0, 100.0), if kind == 1.0 || kind == 2.0 { kind } else { 0.0 }]);
        if load.len() as f64 >= TRANSPORT_LOAD_MOST {
            break;
        }
    }
    load
}

fn read_names(value: &Val, most: usize) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for entry in value.array_or_empty() {
        let name = clean(entry, 120);
        if !name.is_empty() && !names.iter().any(|other| other.to_lowercase() == name.to_lowercase()) {
            names.push(name);
        }
        if names.len() >= most {
            break;
        }
    }
    names
}

fn whole(value: &Val) -> f64 {
    jsmath::max(0.0, jsmath::round(js::or_zero(js::to_number(value))))
}

pub fn normalize_transport(entry: &Val) -> Option<Transport> {
    if !matches!(entry, Val::Obj(_)) {
        return None;
    }
    let id = clean(entry.get("id"), 24);
    let medium = match entry.get("medium") {
        Val::Str(medium) if TRANSPORT_MEDIA.contains(&medium.as_str()) => medium.clone(),
        _ => String::new(),
    };
    let owner = clean(entry.get("owner"), 120);
    let to = read_place(entry.get("to")).or_else(|| {
        let name = clean(entry.get("to").get("name"), 120);
        if name.is_empty() {
            None
        } else {
            Some(Place { lng: None, lat: None, name })
        }
    });
    let to = match to {
        Some(to) if !id.is_empty() && !medium.is_empty() && !owner.is_empty() => to,
        _ => return None,
    };
    let [slow, fast] = transport_speed_km(&medium);
    let or = |value: f64, other: f64| if value != 0.0 && !value.is_nan() { value } else { other };
    let load = read_load(entry.get("load"));
    let status = match entry.get("status") {
        Val::Str(status) if TRANSPORT_STATUSES.contains(&status.as_str()) => status.clone(),
        _ => "ordered".to_string(),
    };
    let mut way: Vec<[f64; 2]> = entry.get("way").array_or_empty().iter().filter_map(read_point).collect();
    way.truncate(WAY_POINTS_MOST);
    let mut record = Transport {
        id,
        kind: clean(entry.get("kind"), 40),
        owner,
        war_id: clean(entry.get("warId"), 80),
        battlefield: clean(entry.get("battlefield"), BATTLEFIELD_NAME_MAX as usize),
        from: read_place(entry.get("from")),
        to,
        speed: clamp(or(jsmath::round(js::or_zero(js::to_number(entry.get("speed")))), slow), slow, fast),
        capacity: clamp(or(jsmath::round(js::or_zero(js::to_number(entry.get("capacity")))), 1.0), TRANSPORT_CAPACITY[0], TRANSPORT_CAPACITY[1]),
        load,
        status,
        ordered: clean(entry.get("ordered"), 40),
        departed: clean(entry.get("departed"), 40),
        due: clean(entry.get("due"), 40),
        ended: clean(entry.get("ended"), 40),
        way,
        km: whole(entry.get("km")),
        gone: whole(entry.get("gone")),
        at: read_point(entry.get("at")),
        landing: read_point(entry.get("landing")),
        hunters: read_names(entry.get("hunters"), TRANSPORT_HUNTERS_MOST),
        hits: whole(entry.get("hits")),
        sunk: whole(entry.get("sunk")),
        by: clean(entry.get("by"), 120),
        note: clean(entry.get("note"), 160),
        medium,
        attacks: None,
        raise: None,
        embark: None,
    };
    let attacks = read_names(entry.get("attacks"), 2);
    if !attacks.is_empty() {
        record.attacks = Some(attacks);
    }
    let raise = jsmath::round(js::or_zero(js::to_number(entry.get("raise"))));
    if raise > 0.0 && record.load.is_empty() {
        record.raise = Some(clamp(raise, 1.0, TRANSPORT_LOAD_MOST));
    }
    let embark = entry.get("embark");
    let side = match embark.get("side") {
        Val::Num(side) if *side == 0.0 || *side == 1.0 => Some(*side),
        _ => None,
    };
    if embark.truthy() && embark.is_object() && !clean(embark.get("battlefield"), 120).is_empty() {
        if let Some(side) = side {
            let mut troops: Vec<f64> = Vec::new();
            for value in embark.get("troops").array_or_empty() {
                let index = js::to_number(value);
                if index.is_finite() && index.trunc() == index && index >= 0.0 {
                    let index = if index == 0.0 { 0.0 } else { index };
                    if !troops.contains(&index) {
                        troops.push(index);
                    }
                }
            }
            troops.truncate(TRANSPORT_LOAD_MOST as usize);
            if !troops.is_empty() {
                record.embark = Some(Embark { battlefield: clean(embark.get("battlefield"), BATTLEFIELD_NAME_MAX as usize), side, troops });
            }
        }
    }
    Some(record)
}

pub fn normalize_transports(value: &Val) -> Vec<Transport> {
    let mut kept: Vec<Transport> = Vec::new();
    for entry in value.array_or_empty() {
        let record = match normalize_transport(entry) {
            Some(record) => record,
            None => continue,
        };
        if kept.iter().any(|other| other.id == record.id) {
            continue;
        }
        kept.push(record);
    }
    let from = kept.len().saturating_sub(MAX_TRANSPORTS);
    kept.split_off(from)
}

pub fn is_under_way(transport: &Transport) -> bool {
    transport.status == "ordered" || transport.status == "moving"
}

pub fn load_of(transport: &Transport) -> f64 {
    let aboard = transport.load.len() as f64;
    if aboard != 0.0 {
        return aboard;
    }
    if let Some(raise) = transport.raise {
        if raise != 0.0 && !raise.is_nan() {
            return raise;
        }
    }
    match &transport.embark {
        Some(embark) if !embark.troops.is_empty() => embark.troops.len() as f64,
        _ => 0.0,
    }
}

pub fn carriers_of(transport: &Transport) -> f64 {
    jsmath::max(1.0, (jsmath::max(1.0, load_of(transport)) / jsmath::max(1.0, transport.capacity)).ceil())
}

pub fn next_transport_id(taken: &[String]) -> String {
    let mut serial = 1u64;
    loop {
        let id = format!("t{serial}");
        if !taken.contains(&id) {
            return id;
        }
        serial += 1;
    }
}

fn place_val(place: &Option<Place>) -> Val {
    match place {
        Some(place) => Val::obj([("lng", place.lng.map(Val::Num).unwrap_or(Val::Null)), ("lat", place.lat.map(Val::Num).unwrap_or(Val::Null)), ("name", Val::str(&place.name))]),
        None => Val::Null,
    }
}

fn point_val(point: &Option<[f64; 2]>) -> Val {
    point.map(|point| Val::nums(&point)).unwrap_or(Val::Null)
}

fn texts_val(names: &[String]) -> Val {
    Val::Arr(names.iter().map(|name| Val::str(name)).collect())
}

pub fn transport_val(transport: &Transport) -> Val {
    let mut out = Obj::new();
    out.set("id", Val::str(&transport.id));
    out.set("medium", Val::str(&transport.medium));
    out.set("kind", Val::str(&transport.kind));
    out.set("owner", Val::str(&transport.owner));
    out.set("warId", Val::str(&transport.war_id));
    out.set("battlefield", Val::str(&transport.battlefield));
    out.set("from", place_val(&transport.from));
    out.set("to", place_val(&Some(transport.to.clone())));
    out.set("speed", Val::Num(transport.speed));
    out.set("capacity", Val::Num(transport.capacity));
    out.set("load", Val::Arr(transport.load.iter().map(|entry| Val::nums(entry)).collect()));
    out.set("status", Val::str(&transport.status));
    out.set("ordered", Val::str(&transport.ordered));
    out.set("departed", Val::str(&transport.departed));
    out.set("due", Val::str(&transport.due));
    out.set("ended", Val::str(&transport.ended));
    out.set("way", Val::Arr(transport.way.iter().map(|point| Val::nums(point)).collect()));
    out.set("km", Val::Num(transport.km));
    out.set("gone", Val::Num(transport.gone));
    out.set("at", point_val(&transport.at));
    out.set("landing", point_val(&transport.landing));
    out.set("hunters", texts_val(&transport.hunters));
    out.set("hits", Val::Num(transport.hits));
    out.set("sunk", Val::Num(transport.sunk));
    out.set("by", Val::str(&transport.by));
    out.set("note", Val::str(&transport.note));
    if let Some(attacks) = &transport.attacks {
        out.set("attacks", texts_val(attacks));
    }
    if let Some(raise) = transport.raise {
        out.set("raise", Val::Num(raise));
    }
    if let Some(embark) = &transport.embark {
        out.set("embark", Val::obj([("battlefield", Val::str(&embark.battlefield)), ("side", Val::Num(embark.side)), ("troops", Val::nums(&embark.troops))]));
    }
    Val::Obj(out)
}

fn ids_of(transports: &[Transport]) -> Vec<String> {
    transports.iter().map(|entry| clean(&Val::str(&entry.id), 120)).collect()
}

pub struct Ordered {
    pub transports: Vec<Transport>,
    pub transport: Transport,
}

pub fn order_transport(transports: &Val, spec: &Val, date: &str, year: Option<f64>) -> Result<Ordered, &'static str> {
    let kept = normalize_transports(transports);
    let medium = match spec.get("medium") {
        Val::Str(medium) if TRANSPORT_MEDIA.contains(&medium.as_str()) => medium.clone(),
        _ => return Err("medium"),
    };
    let usual = carrier_for(&medium, year);
    let named = clean(spec.get("kind"), 40);
    let said = jsmath::round(js::or_zero(js::to_number(spec.get("speed"))));
    if usual.is_none() && !(!named.is_empty() && said > 0.0) {
        return Err("not-yet");
    }
    if kept.iter().filter(|entry| is_under_way(entry)).count() >= MAX_TRANSPORTS - 4 {
        return Err("too-many");
    }
    let kind = if !named.is_empty() {
        named
    } else {
        usual.map(|usual| usual.kind.to_string()).unwrap_or_else(|| medium.clone())
    };
    let capacity = {
        let given = jsmath::round(js::or_zero(js::to_number(spec.get("capacity"))));
        if given != 0.0 && !given.is_nan() {
            Val::Num(given)
        } else {
            match usual {
                Some(usual) => Val::Num(usual.capacity),
                None => Val::Num(1.0),
            }
        }
    };
    let speed = if said > 0.0 { Val::Num(said) } else { usual.map(|usual| Val::Num(usual.speed)).unwrap_or(Val::Undef) };
    let mut ask = Obj::new();
    ask.set("id", Val::Str(next_transport_id(&ids_of(&kept))));
    ask.set("medium", Val::Str(medium));
    ask.set("kind", Val::Str(kind));
    for key in ["owner", "warId", "battlefield", "from", "to"] {
        ask.set(key, spec.get(key).clone());
    }
    ask.set("speed", speed);
    ask.set("capacity", capacity);
    for key in ["load", "raise", "embark"] {
        ask.set(key, spec.get(key).clone());
    }
    ask.set("status", Val::str("ordered"));
    ask.set("ordered", Val::str(date));
    ask.set("by", spec.get("by").clone());
    let record = normalize_transport(&Val::Obj(ask)).ok_or("incomplete")?;
    if record.load.is_empty() && record.raise.is_none() && record.embark.is_none() {
        return Err("nothing-aboard");
    }
    let mut all = kept;
    all.push(record.clone());
    let from = all.len().saturating_sub(MAX_TRANSPORTS);
    Ok(Ordered { transports: all.split_off(from), transport: record })
}

pub fn cancel_transport(transports: &Val, id: &Val) -> Vec<Transport> {
    let id = clean(id, 120);
    normalize_transports(transports).into_iter().filter(|entry| !(entry.id == id && entry.status == "ordered")).collect()
}

pub fn hunt_transport(transports: &Val, id: &Val, hunter: &Val, on: bool) -> Vec<Transport> {
    let id = clean(id, 120);
    let name = clean(hunter, 120);
    let key = fold(hunter);
    normalize_transports(transports)
        .into_iter()
        .map(|entry| {
            if entry.id != id || !is_under_way(&entry) || name.is_empty() || key == fold(&Val::str(&entry.owner)) {
                return entry;
            }
            let mut others: Vec<String> = entry.hunters.iter().filter(|other| fold(&Val::str(other)) != key).cloned().collect();
            if on {
                others.push(name.clone());
                others.truncate(TRANSPORT_HUNTERS_MOST);
            }
            Transport { hunters: others, ..entry }
        })
        .collect()
}

pub struct SetOut<'a> {
    pub grid: &'a mut WorldGrid,
    pub from: &'a Val,
    pub holder_of: &'a dyn Fn(&str) -> String,
    pub friendly: &'a dyn Fn(&str) -> bool,
    pub hostile: &'a dyn Fn(&str) -> bool,
    pub year: Option<f64>,
    pub date: &'a str,
    pub date_of: &'a dyn Fn(f64) -> String,
}

fn refused(transport: &Transport, note: &str, date: &str) -> Transport {
    Transport { status: "refused".into(), note: note.into(), ended: date.into(), ..transport.clone() }
}

pub fn set_out(transport: &Transport, how: SetOut) -> Transport {
    let origin = read_point(how.from).or_else(|| transport.from.as_ref().map(|from| [from.lng.unwrap_or(f64::NAN), from.lat.unwrap_or(f64::NAN)]));
    let origin = match origin {
        Some(origin) => origin,
        None => return refused(transport, "no-origin", how.date),
    };
    let (lng, lat) = match (transport.to.lng, transport.to.lat) {
        (Some(lng), Some(lat)) if lng.is_finite() && lat.is_finite() => (lng, lat),
        _ => return refused(transport, "no-place", how.date),
    };
    let ask = Ask { medium: &transport.medium, from: Some(origin), to: Some([lng, lat]), holder_of: how.holder_of, friendly: how.friendly, hostile: how.hostile, year: how.year };
    match find_way(how.grid, &ask) {
        Way::Error(error) => refused(transport, error, how.date),
        Way::Found { way, km, landing, arrived, .. } => {
            let days = jsmath::max(1.0, (km / jsmath::max(1.0, transport.speed)).ceil());
            Transport {
                status: "moving".into(),
                from: Some(Place { lng: Some(origin[0]), lat: Some(origin[1]), name: transport.from.as_ref().map(|from| from.name.clone()).unwrap_or_default() }),
                departed: how.date.into(),
                due: (how.date_of)(days),
                at: way.first().copied(),
                way,
                km,
                gone: 0.0,
                landing: Some(landing),
                note: if arrived { String::new() } else { "railhead".into() },
                ..transport.clone()
            }
        }
    }
}

pub fn move_on(transport: &Transport, surface: Surface) -> (Transport, bool) {
    let gone = jsmath::min(transport.km, transport.gone + transport.speed);
    let place = place_along(&transport.way, gone, surface);
    let at = match place {
        Some(place) => Some([round3(place.lng), round3(place.lat)]),
        None => transport.at,
    };
    (Transport { gone: jsmath::round(gone), at, ..transport.clone() }, gone >= transport.km)
}

fn intercept_reach(kind: &str, medium: &str) -> f64 {
    match (kind, medium) {
        ("naval", "sea") => 380.0,
        ("naval", "air") => 130.0,
        ("naval", _) => 0.0,
        (_, "sea") => 900.0,
        (_, "air") => 900.0,
        _ => 650.0,
    }
}

fn intercept_base(kind: &str, medium: &str) -> f64 {
    match (kind, medium) {
        ("naval", "sea") => 0.26,
        ("naval", "air") => 0.05,
        ("naval", _) => 0.0,
        (_, "sea") => 0.16,
        (_, "air") => 0.22,
        _ => 0.09,
    }
}

fn shore_reach(medium: &str) -> f64 {
    match medium {
        "sea" => 110.0,
        "air" => 220.0,
        _ => 45.0,
    }
}

fn shore_base(medium: &str) -> f64 {
    match medium {
        "sea" => 0.05,
        "air" => 0.09,
        _ => 0.04,
    }
}

pub const HUNT_BASE: f64 = 0.5;
pub const ESCORT_REACH_KM: f64 = 320.0;
pub const ESCORT_SAVES: f64 = 0.3;
pub const INTERCEPT_CHANCE_MOST: f64 = 0.9;
pub const HIT_SHARE: [f64; 2] = [0.3, 0.85];

pub fn transport_chance(seed: &str, id: &str, day: f64, what: &str) -> f64 {
    (hash_seed(&format!("{seed}|transport|{id}|{}|{what}", js::number_to_string(day))) % 10000) as f64 / 10000.0
}

pub struct Watch<'a> {
    pub units: &'a [Val],
    pub enemy: &'a dyn Fn(&str) -> bool,
    pub ally: &'a dyn Fn(&str) -> bool,
    pub grid: Option<&'a WorldGrid>,
    pub holder_of: &'a dyn Fn(&str) -> Val,
    pub surface: Surface,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Interception {
    pub chance: f64,
    pub by: String,
    pub with: String,
    pub threats: usize,
}

struct Threat {
    by: String,
    with: String,
    weight: f64,
}

pub fn interception_of(transport: &Transport, at: [f64; 2], watch: Watch) -> Interception {
    let medium = transport.medium.as_str();
    let far = |lng: f64, lat: f64| km_between(at[0], at[1], lng, lat, watch.surface);
    let mut threats: Vec<Threat> = Vec::new();
    let mut cover = 0.0;
    let mut hunting: Vec<String> = Vec::new();
    for name in &transport.hunters {
        let key = fold(&Val::str(name));
        if !hunting.contains(&key) {
            hunting.push(key);
        }
    }
    let mut hunted: OrdMap<String, (String, String)> = OrdMap::new();
    for unit in watch.units {
        let kind = match unit.get("type") {
            Val::Str(kind) if kind == "naval" || kind == "air" => kind.as_str(),
            _ => "",
        };
        let owner = clean(unit.get("ownerCode"), 120);
        let lng = js::to_number(unit.get("lng"));
        let lat = js::to_number(unit.get("lat"));
        if kind.is_empty() || owner.is_empty() || !lng.is_finite() || !lat.is_finite() || !clean(unit.get("committedTo"), 120).is_empty() {
            continue;
        }
        let strength = clamp(js::or_zero(js::to_number(unit.get("strength"))) / 100.0, 0.0, 1.5);
        if !(strength > 0.0) {
            continue;
        }
        let distance = far(lng, lat);
        if (watch.ally)(&owner) {
            if distance <= ESCORT_REACH_KM && (kind == "air" || medium == "sea") {
                cover += strength;
            }
            continue;
        }
        if !(watch.enemy)(&owner) {
            continue;
        }
        let reach = intercept_reach(kind, medium);
        if reach > 0.0 && distance < reach {
            threats.push(Threat { by: owner.clone(), with: clean(unit.get("name"), 120), weight: intercept_base(kind, medium) * strength * (1.0 - distance / reach) });
        }
        let key = fold(&Val::str(&owner));
        if hunting.contains(&key) && reach > 0.0 && distance < reach * 2.0 {
            hunted.set(key, (owner.clone(), clean(unit.get("name"), 120)));
        }
    }
    if let Some(grid) = watch.grid {
        let reach = shore_reach(medium);
        let cell = grid.cell_of(at[0], at[1]);
        if cell >= 0.0 {
            let step_km = jsmath::max(1.0, grid.km(at[0], at[1], at[0], at[1] + grid.step));
            let rings = jsmath::min(40.0, ((reach * (if !hunting.is_empty() { 3.0 } else { 1.0 })) / step_km).ceil()) as i64;
            let cols = grid.cols as i64;
            let row = (cell / grid.cols as f64).floor() as i64;
            let col = (cell % grid.cols as f64) as i64;
            let mut nearest: OrdMap<String, (String, f64)> = OrdMap::new();
            for dy in -rings..=rings {
                let y = row + dy;
                if y < 0 || y >= grid.rows as i64 {
                    continue;
                }
                for dx in -rings..=rings {
                    let mut x = col + dx;
                    if grid.wrap {
                        x = ((x % cols) + cols) % cols;
                    } else if x < 0 || x >= cols {
                        continue;
                    }
                    let mark = grid.region[(y * cols + x) as usize];
                    if mark == 0 {
                        continue;
                    }
                    let name = clean(&(watch.holder_of)(&grid.ids[mark as usize]), 120);
                    if name.is_empty() || !(watch.enemy)(&name) {
                        continue;
                    }
                    let [lng, lat] = grid.centre_of((y * cols + x) as f64);
                    let distance = far(lng, lat);
                    let key = fold(&Val::str(&name));
                    let closer = match nearest.get(&key) {
                        Some((_, before)) => distance < *before,
                        None => true,
                    };
                    if closer {
                        nearest.set(key, (name, distance));
                    }
                }
            }
            for (key, (by, distance)) in &nearest.entries {
                if *distance < reach {
                    threats.push(Threat { by: by.clone(), with: String::new(), weight: shore_base(medium) * (1.0 - distance / reach) });
                }
                if hunting.contains(key) && *distance < reach * 3.0 && !hunted.has(key) {
                    hunted.set(key.clone(), (by.clone(), String::new()));
                }
            }
        }
    }
    for (by, with) in hunted.values() {
        threats.push(Threat { by: by.clone(), with: with.clone(), weight: HUNT_BASE });
    }
    let mut total = 0.0;
    for threat in &threats {
        total += threat.weight;
    }
    total *= jsmath::max(1.0 - ESCORT_SAVES * 2.2, 1.0 - ESCORT_SAVES * cover);
    let mut order: Vec<usize> = (0..threats.len()).collect();
    js::stable_sort_by(&mut order, |&a, &b| threats[b].weight - threats[a].weight);
    let first = order.first().map(|&at| &threats[at]);
    Interception { chance: jsmath::min(INTERCEPT_CHANCE_MOST, total / (1.0 + total)), by: first.map(|threat| threat.by.clone()).unwrap_or_default(), with: first.map(|threat| threat.with.clone()).unwrap_or_default(), threats: threats.len() }
}

pub fn struck(transport: &Transport, draw: f64, date: &str) -> (Transport, f64) {
    let aboard = transport.load.len() as f64;
    if aboard == 0.0 {
        return (Transport { status: "lost".into(), ended: date.into(), hits: transport.hits + 1.0, ..transport.clone() }, 0.0);
    }
    let share = HIT_SHARE[0] + (HIT_SHARE[1] - HIT_SHARE[0]) * clamp(draw, 0.0, 1.0);
    let lost = clamp(jsmath::max(jsmath::min(transport.capacity, aboard), jsmath::round(aboard * share)), 1.0, aboard);
    let keep = (aboard - lost).max(0.0) as usize;
    let next = Transport { load: transport.load[..keep.min(transport.load.len())].to_vec(), hits: transport.hits + 1.0, sunk: transport.sunk + lost, ..transport.clone() };
    if next.load.is_empty() {
        (Transport { status: "lost".into(), ended: date.into(), ..next }, lost)
    } else {
        (next, lost)
    }
}

pub fn transport_title(transport: &Transport) -> String {
    format!("{} of {}", if transport.kind.is_empty() { &transport.medium } else { &transport.kind }, transport.owner)
}

pub fn to_fixed(value: f64, digits: usize) -> String {
    if value.is_nan() {
        return "NaN".into();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let size = value.abs();
    let exact = format!("{:.1100}", size);
    let point = exact.find('.').unwrap_or(exact.len());
    let tail = &exact[point + 1..];
    let tie = tail.as_bytes().get(digits) == Some(&b'5') && tail[digits + 1..].bytes().all(|unit| unit == b'0');
    let text = if tie {
        let scale = 10f64.powi(digits as i32);
        format!("{:.*}", digits, ((size * scale).floor() + 1.0) / scale)
    } else {
        format!("{:.*}", digits, size)
    };
    format!("{sign}{text}")
}

pub fn bound_for(transport: &Transport) -> String {
    if !transport.to.name.is_empty() {
        return transport.to.name.clone();
    }
    match transport.to.lat {
        Some(lat) if lat.is_finite() => format!("{}, {}", to_fixed(lat, 1), to_fixed(transport.to.lng.unwrap_or(f64::NAN), 1)),
        _ => String::new(),
    }
}
