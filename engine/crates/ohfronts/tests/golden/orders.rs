use crate::field::{place_val, sector_val, sectors_of};
use crate::fronts::*;
use crate::support::{self, *};
use crate::troops::named_of;
use ohfronts::sim::battle::Battle;
use ohfronts::sim::engine::Run;
use ohfronts::sim::field::Contour;
use ohfronts::sim::js::{Obj, Val};
use ohfronts::sim::orders::*;
use ohfronts::sim::sectors::Sectors;
use std::rc::Rc;

pub fn shallow(value: &Val) -> Val {
    match value {
        Val::Ref(cell) => Val::Obj(cell.borrow().clone()),
        other => other.clone(),
    }
}

fn troop_refs(value: &Val) -> [Vec<Val>; 2] {
    [0, 1].map(|side| value.get("troops").at(side).array_or_empty().to_vec())
}

fn index_of(troops: &[Vec<Val>; 2], unit: &Val) -> Option<(usize, usize)> {
    for side in 0..2 {
        if let Some(at) = troops[side].iter().position(|troop| troop.same_ref(unit)) {
            return Some((side, at));
        }
    }
    None
}

fn fix_in(value: &mut Val, troops: &[Vec<Val>; 2], seen: &mut Vec<*const ()>) {
    match value {
        Val::Ref(cell) => {
            let key = Rc::as_ptr(cell) as *const ();
            if seen.contains(&key) {
                return;
            }
            seen.push(key);
            let mut inner = Val::Obj(cell.borrow().clone());
            fix_in(&mut inner, troops, seen);
            if let Val::Obj(obj) = inner {
                *cell.borrow_mut() = obj;
            }
        }
        Val::Obj(obj) => {
            for (key, item) in obj.0.iter_mut() {
                if key == "unit" && item.is_object() && !matches!(item, Val::Arr(_)) {
                    *item = unit_val(index_of(troops, item));
                } else {
                    fix_in(item, troops, seen);
                }
            }
        }
        Val::Arr(list) => {
            for item in list.iter_mut() {
                fix_in(item, troops, seen);
            }
        }
        _ => {}
    }
}

pub fn fix_units(value: &mut Val, troops: &[Vec<Val>; 2]) {
    let mut seen = Vec::new();
    fix_in(value, troops, &mut seen);
}

pub fn unshared(value: &Val) -> Val {
    let refs = troop_refs(value);
    let mut out = match value {
        Val::Obj(obj) => Obj(obj.0.iter().map(|(key, item)| (key.clone(), if key == "troops" || key == "orders" { item.clone() } else { item.plain() })).collect()),
        Val::Ref(cell) => Obj(cell.borrow().0.iter().map(|(key, item)| (key.clone(), if key == "troops" || key == "orders" { item.clone() } else { item.plain() })).collect()),
        _ => Obj::new(),
    };
    if value.get("troops").is_object() {
        let mut troops = Val::Arr(refs.iter().map(|side| Val::Arr(side.iter().map(|troop| {
            let mut troop = shallow(troop);
            if let Val::Obj(fields) = &mut troop {
                for key in ["order", "fallback"] {
                    if let Some(item) = fields.get(key) {
                        let flat = shallow(item);
                        fields.set(key, flat);
                    }
                }
            }
            troop
        }).collect())).collect());
        fix_units(&mut troops, &refs);
        out.set("troops", troops);
    }
    let mut orders = value.get("orders").clone();
    fix_units(&mut orders, &refs);
    out.set("orders", orders);
    Val::Obj(out)
}

pub fn order_battle(run: &Run, value: &Val) -> Battle {
    let value = unshared(value);
    let mut battle = pick_battle(run, &value);
    battle.orders = value.get("orders").array_or_empty().iter().map(|order| order.clone().share()).collect();
    battle.halts = value.get("halts").array_or_empty().iter().map(shallow).collect();
    battle.named = named_of(value.get("named"));
    battle.status = value.get("status").string_or_empty();
    if value.get("startPhi").is_object() {
        battle.start_phi = Some(arg_numbers(value.get("startPhi")));
    }
    if value.get("effort").is_object() {
        battle.effort = [0, 1].map(|side| value.get("effort").at(side).string_or_empty());
    }
    if let Val::Num(changed) = value.get("ordersChanged") {
        battle.orders_changed = *changed;
    }
    battle.plan_key = value.get("planKey").string_or_empty();
    battle.closing = value.get("closing").string_or_empty();
    battle
}

pub fn order_run(value: &Val) -> Run {
    let value = &value.plain();
    let mut run = run_lite(value);
    run.days = value.get("days").num();
    let mut input = Obj::new();
    input.set("players", value.get("input").get("players").clone());
    input.set("map", value.get("input").get("map").clone());
    run.input = std::rc::Rc::new(Val::Obj(input));
    run
}

pub struct Line {
    pub contour: Contour,
    pub count: usize,
    pub sectors: Sectors,
}

pub fn line_of(today: &Val) -> Line {
    let today = &today.plain();
    let line = today.get("line");
    Line {
        contour: Contour { x: arg_numbers(line.get("contour").get("x")), y: arg_numbers(line.get("contour").get("y")), ..Contour::default() },
        count: line.get("count").num() as usize,
        sectors: if today.get("sectors").is_object() { sectors_of(today.get("sectors")) } else { Sectors { axis: String::new(), names: Vec::new(), cuts: Vec::new() } },
    }
}

pub fn view_val(view: &OrderView) -> Val {
    Val::obj([
        ("order", view.order.clone()),
        ("word", view.word.clone()),
        ("sector", sector_val(&view.sector)),
        ("target", view.target.as_ref().map(place_val).unwrap_or(Val::Null)),
        ("age", view.age.clone()),
        ("middle", view.middle.map(point_val).unwrap_or(Val::Null)),
    ])
}

pub fn wanted(case: &Case, at: usize) -> Val {
    let mut want = unshared(&want_after(case, at));
    let before = unshared(case.arg(at));
    if let Val::Obj(out) = &mut want {
        if let Some(Val::Arr(sides)) = out.get_mut("troops") {
            for (side, troops) in sides.iter_mut().enumerate() {
                if let Val::Arr(troops) = troops {
                    for (index, troop) in troops.iter_mut().enumerate() {
                        let had = before.get("troops").at(side).at(index);
                        if let (Val::Obj(fields), Val::Obj(had)) = (troop, had) {
                            fields.0.retain(|(key, _)| had.has(key));
                        }
                    }
                }
            }
        }
    }
    want
}

pub fn orders_like(battle: &Battle, want: &Val) -> Result<(), String> {
    if !want.get("orders").is_undef() {
        same(&list(battle.orders.clone()), want.get("orders")).map_err(|error| format!("orders: {error}"))?;
    }
    Ok(())
}

pub fn battle_like(battle: &Battle, want: &Val) -> Result<(), String> {
    troops_like(battle, want)?;
    orders_like(battle, want)?;
    let got = Val::obj([
        ("halts", list(battle.halts.clone())),
        ("ordersChanged", num(battle.orders_changed)),
        ("pool", nums(&battle.pool)),
        ("effort", list(battle.effort.iter().map(|word| text(word)).collect())),
        ("log", list(battle.log.clone())),
        ("closing", text(&battle.closing)),
        ("anchors", list(battle.anchors.clone())),
        ("planKey", text(&battle.plan_key)),
        ("sieges", list(battle.sieges.clone())),
        ("siegeKey", text(&battle.siege_key)),
        ("spared", list(battle.spared.iter().map(|side| nums(side)).collect())),
    ]);
    for key in ["halts", "ordersChanged", "pool", "effort", "log", "closing", "anchors", "planKey", "sieges", "siegeKey", "spared"] {
        if !want.get(key).is_undef() {
            same(got.get(key), want.get(key)).map_err(|error| format!("{key}: {error}"))?;
        }
    }
    if let Some(field) = &battle.field {
        let wants = want.get("field");
        if wants.get("holders").is_object() {
            same(&u8s(field.holders.clone()), wants.get("holders")).map_err(|error| format!("holders: {error}"))?;
        }
        if wants.get("phi").is_object() {
            same(&typed_f64(&field.phi), wants.get("phi")).map_err(|error| format!("phi: {error}"))?;
        }
    }
    Ok(())
}

fn order_day<'a>(today: &'a Val, line: &'a Line, date: &'a str) -> OrderDay<'a> {
    OrderDay { day: today.get("day").num(), date, contour: &line.contour, count: line.count, sectors: &line.sectors }
}

fn find_order(battle: &Battle, value: &Val) -> Val {
    battle.orders.iter().find(|order| order.same_ref(value)).cloned().unwrap_or_else(|| shallow(value).share())
}

fn arg_order(case: &Case, battle_at: usize, at: usize) -> Val {
    let value = case.arg(at).clone();
    let mut fixed = value.clone();
    fix_units(&mut fixed, &troop_refs(case.arg(battle_at)));
    fixed
}

fn checked(parts: Vec<Result<(), String>>) -> Option<Result<(), String>> {
    for part in parts {
        if part.is_err() {
            return Some(part);
        }
    }
    Some(Ok(()))
}

#[test]
fn orders_match_js() {
    support::run(
        "orders",
        &[
            ("memberOf", &|case| {
                let run = bare_run();
                let battle = order_battle(&run, case.arg(0));
                let [side, index] = member_of(&battle, case.arg(1));
                expect(case, nums(&[side as f64, index as f64]))
            }),
            ("readSieges", &|case| {
                let run = bare_run();
                let mut battle = order_battle(&run, case.arg(0));
                read_sieges(&mut battle);
                checked(vec![battle_like(&battle, &wanted(case, 0))])
            }),
            ("readOrders", &|case| {
                let run = bare_run();
                let mut battle = order_battle(&run, case.arg(0));
                let today = Val::obj([("line", case.arg(1).clone()), ("sectors", case.arg(2).clone())]);
                let line = line_of(&today);
                read_orders(&mut battle, &line.contour, line.count, &line.sectors);
                let want = wanted(case, 0);
                let views = list(battle.views.iter().map(|side| list(side.iter().map(view_val).collect())).collect());
                let halts = list(battle.halts_today.iter().map(|halt| Val::obj([("s", halt.s.clone()), ("sector", sector_val(&halt.sector))])).collect());
                checked(vec![
                    battle_like(&battle, &want),
                    same(&views, want.get("views")).map_err(|error| format!("views: {error}")),
                    same(&halts, want.get("haltsToday")).map_err(|error| format!("haltsToday: {error}")),
                ])
            }),
            ("ageOrders", &|case| {
                let run = bare_run();
                let mut battle = order_battle(&run, case.arg(0));
                age_orders(&mut battle);
                checked(vec![battle_like(&battle, &wanted(case, 0))])
            }),
            ("takesOrder", &|case| {
                let run = order_run(case.arg(1));
                let battle = order_battle(&run, case.arg(0));
                let order = find_order(&battle, &arg_order(case, 0, 2));
                let line = line_of(case.arg(3));
                let today = order_day(case.arg(3), &line, "");
                let takes = takes_order(&battle, if case.arg(1).is_object() { Some(&run) } else { None }, &order, &today);
                if case.result_calls.is_empty() {
                    return None;
                }
                Some(Case::replay(&case.result_calls, |args| Val::Bool(takes.takes(&troop_full(&shallow(&args[0])), &battle.place))))
            }),
            ("setStandingOrder", &|case| {
                let run = bare_run();
                let mut battle = order_battle(&run, case.arg(0));
                let order = arg_order(case, 0, 2);
                let order = battle.orders.iter().find(|standing| standing.same_ref(&order)).cloned().unwrap_or(order);
                let set = set_standing_order(&mut battle, case.arg(1).num() as usize, &order);
                checked(vec![expect(case, set).unwrap_or(Ok(())), battle_like(&battle, &wanted(case, 0))])
            }),
            ("assignOrder", &|case| {
                let run = order_run(case.arg(1));
                let mut battle = order_battle(&run, case.arg(0));
                let mut order = find_order(&battle, &arg_order(case, 0, 2));
                let line = line_of(case.arg(3));
                let today = order_day(case.arg(3), &line, "");
                let options = case.arg(4);
                let picked = if options.get("picked").as_array().is_some() { Some(indexes(options.get("picked"))) } else { None };
                let done = assign_order(&mut battle, &run, &mut order, &today, picked.as_deref(), options.get("lagless").truthy());
                checked(vec![expect(case, Val::Bool(done)).unwrap_or(Ok(())), battle_like(&battle, &wanted(case, 0))])
            }),
            ("standingOf", &|case| {
                let run = bare_run();
                let battle = order_battle(&run, case.arg(0));
                let mut troop = case.arg(1).clone();
                fix_units(&mut troop, &troop_refs(case.arg(0)));
                let troop = troop_full(&shallow(&troop));
                expect(case, standing_of(&battle, &troop).unwrap_or(Val::Null))
            }),
            ("servingOf", &|case| {
                let run = bare_run();
                let battle = order_battle(&run, case.arg(0));
                let troop = troop_full(&shallow(case.arg(1)));
                expect(case, num(serving_of(&battle, &troop) as f64))
            }),
            ("giveWay", &|case| {
                let run = bare_run();
                let mut battle = order_battle(&run, case.arg(0));
                let reach = if case.arg(4).is_undef() { 6.0 } else { case.arg(4).num() };
                give_way(&mut battle, case.arg(1).num() as usize, case.arg(2).num(), &case.arg(3).string_or_empty(), reach);
                checked(vec![battle_like(&battle, &wanted(case, 0))])
            }),
            ("putAshore", &|case| {
                let run = bare_run();
                let mut battle = order_battle(&run, case.arg(0));
                let count = put_ashore(&mut battle, case.arg(1).num() as usize, case.arg(2).num(), case.arg(3).num(), case.arg(4), case.arg(5).num());
                checked(vec![expect(case, num(count as f64)).unwrap_or(Ok(())), battle_like(&battle, &wanted(case, 0))])
            }),
            ("landCarried", &|case| {
                let run = bare_run();
                let mut battle = order_battle(&run, case.arg(0));
                let got = land_carried(&mut battle, case.arg(1).num() as usize, case.arg(2).num(), case.arg(3).num(), case.arg(4), case.arg(5).num(), &case.arg(6).string_or_empty());
                let result = Val::obj([("landed", num(got.landed as f64)), ("x", num(got.x)), ("y", num(got.y)), ("hostile", Val::Bool(got.hostile))]);
                checked(vec![expect(case, result).unwrap_or(Ok(())), battle_like(&battle, &wanted(case, 0))])
            }),
            ("applyOrder", &|case| {
                let today = case.arg(2);
                let run = order_run(today.get("run"));
                let mut battle = order_battle(&run, case.arg(0));
                let line = line_of(today);
                let date = today.get("date").string_or_empty();
                let day = order_day(today, &line, &date);
                let mut notes = case.arg(3).array_or_empty().to_vec();
                apply_order(&mut battle, &run, case.arg(1), &day, &mut notes);
                if std::env::var("DEBUG_ORDERS").is_ok() {
                    eprintln!("orders {:?} troops {} live {} first {:?} notes {:?} days {} adv {:?}", battle.orders.len(), battle.troops[0].len(), battle.troops[0].iter().filter(|t| t.strength > 0.0).count(), battle.troops[0].first().map(|t| (t.x, t.y, t.order.clone())), notes, run.days, run.advance_km);
                }
                checked(vec![battle_like(&battle, &wanted(case, 0)), same(&list(notes), &want_after(case, 3)).map_err(|error| format!("notes: {error}"))])
            }),
        ],
    );
}
