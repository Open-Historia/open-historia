use crate::support::*;
use crate::world_grid::{grid_of, plain_surface_of as surface_of};
use ohfronts::sim::js::{self, Val};
use ohfronts::sim::transports::*;

fn opt_num_of(value: &Val) -> Option<f64> {
    match value {
        Val::Num(n) => Some(*n),
        _ => None,
    }
}

fn place_of(value: &Val) -> Option<Place> {
    if !value.is_object() {
        return None;
    }
    Some(Place { lng: opt_num_of(value.get("lng")), lat: opt_num_of(value.get("lat")), name: value.get("name").string_or_empty() })
}

fn pair_of(value: &Val) -> Option<[f64; 2]> {
    value.as_array().map(|_| [value.element(0).num(), value.element(1).num()])
}

fn texts_of(value: &Val) -> Vec<String> {
    value.array_or_empty().iter().map(|item| item.string_or_empty()).collect()
}

pub fn transport_of(value: &Val) -> Transport {
    let s = |key: &str| value.get(key).string_or_empty();
    let n = |key: &str| value.get(key).num();
    let embark = value.get("embark");
    Transport {
        id: s("id"),
        medium: s("medium"),
        kind: s("kind"),
        owner: s("owner"),
        war_id: s("warId"),
        battlefield: s("battlefield"),
        from: place_of(value.get("from")),
        to: place_of(value.get("to")).unwrap_or(Place { lng: None, lat: None, name: String::new() }),
        speed: n("speed"),
        capacity: n("capacity"),
        load: value.get("load").array_or_empty().iter().filter_map(pair_of).collect(),
        status: s("status"),
        ordered: s("ordered"),
        departed: s("departed"),
        due: s("due"),
        ended: s("ended"),
        way: value.get("way").array_or_empty().iter().filter_map(pair_of).collect(),
        km: n("km"),
        gone: n("gone"),
        at: pair_of(value.get("at")),
        landing: pair_of(value.get("landing")),
        hunters: texts_of(value.get("hunters")),
        hits: n("hits"),
        sunk: n("sunk"),
        by: s("by"),
        note: s("note"),
        attacks: value.get("attacks").as_array().map(|_| texts_of(value.get("attacks"))),
        raise: opt_num_of(value.get("raise")),
        embark: if embark.is_object() { Some(Embark { battlefield: embark.get("battlefield").string_or_empty(), side: embark.get("side").num(), troops: arg_numbers(embark.get("troops")) }) } else { None },
    }
}

fn list_val(transports: &[Transport]) -> Val {
    list(transports.iter().map(transport_val).collect())
}

fn year_of(value: &Val) -> Option<f64> {
    opt_num_of(value)
}

fn carrier_val(carrier: Option<Carrier>) -> Val {
    carrier
        .map(|c| match c.most {
            Some(most) => Val::obj([("since", num(c.since)), ("kind", text(c.kind)), ("speed", num(c.speed)), ("capacity", num(c.capacity)), ("most", num(most))]),
            None => Val::obj([("since", num(c.since)), ("kind", text(c.kind)), ("speed", num(c.speed)), ("capacity", num(c.capacity))]),
        })
        .unwrap_or(Val::Null)
}

fn media_of(value: &Val) -> Option<Vec<String>> {
    value.as_array().map(|list| list.iter().map(js::to_string).collect())
}

fn airlift_surface(options: &Val) -> ohfronts::sim::world_grid::Surface {
    let plain = surface_of(&Val::obj([("flat", options.get("flat").clone()), ("scale", options.get("scale").clone())]));
    ohfronts::sim::world_grid::Surface { flat: plain.flat, scale: plain.scale, factor: 1.0, metric: None }
}

fn join_text(value: &Val) -> String {
    if value.is_nullish() {
        String::new()
    } else {
        js::to_string(value)
    }
}

#[test]
fn transports_matches_js() {
    run(
        "transports",
        &[
            ("boundFor", &|case| expect(case, text(&bound_for(&transport_of(case.arg(0)))))),
            ("carriersOf", &|case| expect(case, num(carriers_of(&transport_of(case.arg(0)))))),
            ("loadOf", &|case| expect(case, num(load_of(&transport_of(case.arg(0)))))),
            ("isUnderWay", &|case| expect(case, Val::Bool(case.arg(0).is_object() && is_under_way(&transport_of(case.arg(0)))))),
            ("carrierFor", &|case| expect(case, carrier_val(carrier_for(&js::to_string(case.arg(0)), year_of(case.arg(1)))))),
            ("cancelTransport", &|case| expect(case, list_val(&cancel_transport(case.arg(0), case.arg(1))))),
            ("huntTransport", &|case| {
                let on = case.arg(3).is_undef() || case.arg(3).truthy();
                expect(case, list_val(&hunt_transport(case.arg(0), case.arg(1), case.arg(2), on)))
            }),
            ("normalizeTransport", &|case| expect(case, normalize_transport(case.arg(0)).map(|t| transport_val(&t)).unwrap_or(Val::Null))),
            ("normalizeTransports", &|case| expect(case, list_val(&normalize_transports(case.arg(0))))),
            ("orderTransport", &|case| {
                let options = case.arg(2);
                let got = match order_transport(case.arg(0), case.arg(1), &options.get("date").string_or_empty(), year_of(options.get("year"))) {
                    Ok(ordered) => Val::obj([("transports", list_val(&ordered.transports)), ("transport", transport_val(&ordered.transport))]),
                    Err(error) => Val::obj([("error", text(error))]),
                };
                expect(case, got)
            }),
            ("moveOn", &|case| {
                let (transport, arrived) = move_on(&transport_of(case.arg(0)), surface_of(case.arg(1)));
                expect(case, Val::obj([("transport", transport_val(&transport)), ("arrived", Val::Bool(arrived))]))
            }),
            ("setOut", &|case| {
                let options = case.arg(1);
                let mut grid = grid_of(options.get("grid"));
                let holder = Script::new(case, "1.holderOf");
                let friendly = Script::new(case, "1.friendly");
                let hostile = Script::new(case, "1.hostile");
                let dated = Script::new(case, "1.dateOf");
                let has = |key: &str| matches!(options.get(key), Val::Fn);
                let holder_of = |id: &str| if has("holderOf") { holder.call(&[text(id)]).string_or_empty() } else { String::new() };
                let is_friendly = |name: &str| has("friendly") && friendly.call(&[text(name)]).truthy();
                let is_hostile = |name: &str| has("hostile") && hostile.call(&[text(name)]).truthy();
                let date_of = |days: f64| if has("dateOf") { dated.call(&[num(days)]).string_or_empty() } else { String::new() };
                let date = options.get("date").string_or_empty();
                let got = set_out(
                    &transport_of(case.arg(0)),
                    SetOut { grid: &mut grid, from: options.get("from"), holder_of: &holder_of, friendly: &is_friendly, hostile: &is_hostile, year: year_of(options.get("year")), date: &date, date_of: &date_of },
                );
                Some(expect(case, transport_val(&got))?.and_then(|_| holder.done()).and_then(|_| friendly.done()).and_then(|_| hostile.done()).and_then(|_| dated.done()))
            }),
            ("departuresFor", &|case| {
                let options = case.arg(0);
                let holder = Script::new(case, "0.holderAt");
                let measure = Script::new(case, "0.km");
                let holder_at = |lng: f64, lat: f64| if matches!(options.get("holderAt"), Val::Fn) { js::to_string(&holder.call(&[num(lng), num(lat)])) } else { String::new() };
                let km = |a: f64, b: f64, c: f64, d: f64| js::to_number(&measure.call(&[num(a), num(b), num(c), num(d)]));
                let collate = |a: &str, b: &str| match js::compare_units(a, b) {
                    std::cmp::Ordering::Less => -1.0,
                    std::cmp::Ordering::Greater => 1.0,
                    std::cmp::Ordering::Equal => 0.0,
                };
                let most = if options.get("most").is_undef() { 8.0 } else { options.get("most").num() };
                let cities = options.get("cities").array_or_empty().to_vec();
                let owner = if options.get("owner").is_undef() { String::new() } else { js::to_string(options.get("owner")) };
                let found = departures_for(Departures { cities: &cities, holder_at: &holder_at, owner: &owner, to: options.get("to"), near: options.get("near"), km: &km, most, collate: &collate });
                let value = list(found.iter().map(|(lng, lat, name)| Val::obj([("lng", num(*lng)), ("lat", num(*lat)), ("name", text(name))])).collect());
                Some(expect(case, value)?.and_then(|_| holder.done()).and_then(|_| measure.done()))
            }),
            ("interceptionOf", &|case| {
                let options = case.arg(2);
                let grid = if options.get("grid").truthy() { Some(grid_of(options.get("grid"))) } else { None };
                let enemy = Script::new(case, "2.enemy");
                let ally = Script::new(case, "2.ally");
                let holder = Script::new(case, "2.holderOf");
                let has = |key: &str| matches!(options.get(key), Val::Fn);
                let is_enemy = |name: &str| has("enemy") && enemy.call(&[text(name)]).truthy();
                let is_ally = |name: &str| has("ally") && ally.call(&[text(name)]).truthy();
                let holder_of = |id: &str| if has("holderOf") { holder.call(&[text(id)]) } else { text("") };
                let units = options.get("units").array_or_empty().to_vec();
                let at = [case.arg(1).element(0).num(), case.arg(1).element(1).num()];
                let got = interception_of(&transport_of(case.arg(0)), at, Watch { units: &units, enemy: &is_enemy, ally: &is_ally, grid: grid.as_ref(), holder_of: &holder_of, surface: surface_of(options) });
                let value = Val::obj([("chance", num(got.chance)), ("by", text(&got.by)), ("with", text(&got.with)), ("threats", num(got.threats as f64))]);
                Some(expect(case, value)?.and_then(|_| enemy.done()).and_then(|_| ally.done()).and_then(|_| holder.done()))
            }),
            ("struck", &|case| {
                let date = if case.arg(2).is_undef() { String::new() } else { case.arg(2).string_or_empty() };
                let (transport, lost) = struck(&transport_of(case.arg(0)), case.arg(1).num(), &date);
                expect(case, Val::obj([("transport", transport_val(&transport)), ("lost", num(lost))]))
            }),
            ("transportChance", &|case| {
                if !arg_is_number(case.arg(2)) {
                    return None;
                }
                expect(case, num(transport_chance(&join_text(case.arg(0)), &join_text(case.arg(1)), case.arg(2).num(), &join_text(case.arg(3)))))
            }),
            ("transportTitle", &|case| expect(case, text(&transport_title(&transport_of(case.arg(0)))))),
            ("transportBar", &|case| {
                let options = case.arg(1);
                let media = media_of(options.get("media"));
                expect(case, text(transport_bar(&js::to_string(case.arg(0)), media.as_deref(), options.get("military"))))
            }),
            ("airliftMost", &|case| expect(case, num(airlift_most(year_of(case.arg(0)), case.arg(1))))),
            ("transportLoadMost", &|case| expect(case, num(transport_load_most(&js::to_string(case.arg(0)), year_of(case.arg(1)), case.arg(2))))),
            ("stretchOf", &|case| {
                let way: Vec<[f64; 2]> = case.arg(0).array_or_empty().iter().filter_map(pair_of).collect();
                let points = stretch_of(&way, js::to_number(case.arg(1)), js::to_number(case.arg(2)), surface_of(case.arg(3)));
                expect(case, list(points.iter().map(|point| Val::nums(point)).collect()))
            }),
            ("airliftIntercepts", &|case| {
                let options = case.arg(1);
                let holder = Script::new(case, "1.holderAt");
                let enemy = Script::new(case, "1.enemy");
                let worth = Script::new(case, "1.worthOf");
                let roll = Script::new(case, "1.roll");
                let has = |key: &str| matches!(options.get(key), Val::Fn);
                let over: Vec<[f64; 2]> = options.get("over").array_or_empty().iter().filter_map(pair_of).collect();
                let holder_at = |lng: f64, lat: f64| if has("holderAt") { holder.call(&[num(lng), num(lat)]) } else { text("") };
                let is_enemy = |name: &str| has("enemy") && enemy.call(&[text(name)]).truthy();
                let worth_of = |name: &str| if has("worthOf") { worth.call(&[text(name)]) } else { num(1.0) };
                let rolled = |what: &str| if has("roll") { js::to_number(&roll.call(&[text(what)])) } else { 1.0 };
                let era = if options.get("era").is_undef() { num(3.0) } else { options.get("era").clone() };
                let got = airlift_intercepts(
                    &case.arg(0).get("owner").string_or_empty(),
                    Airlift { over: &over, holder_at: &holder_at, enemy: &is_enemy, units: options.get("units").array_or_empty(), era, worth_of: &worth_of, roll: &rolled, surface: airlift_surface(options) },
                );
                let value = Val::obj([
                    ("over", list(got.over.iter().map(|name| text(name)).collect())),
                    ("found", list(got.found.iter().map(|finder| Val::obj([("by", text(&finder.by)), ("with", text(&finder.with)), ("at", Val::nums(&finder.at))])).collect())),
                ]);
                for script in [&holder, &enemy, &worth, &roll] {
                    if let Err(error) = script.done() {
                        return Some(Err(error));
                    }
                }
                expect(case, value)
            }),
        ],
    );
}
