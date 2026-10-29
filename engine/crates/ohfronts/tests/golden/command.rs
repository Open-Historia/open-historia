use crate::manpower::battle_of;
use crate::support::*;
use ohfronts::sim::command::*;
use ohfronts::sim::engine::{create_run, NoHooks};
use ohfronts::sim::js::{self, Val};
use ohfronts::sim::troops::{create_troop, TroopSeed};

fn points_of(value: &Val) -> Vec<[f64; 2]> {
    value.array_or_empty().iter().map(|p| [p.element(0).num(), p.element(1).num()]).collect()
}

fn general_val(general: &General) -> Val {
    Val::obj([
        ("command", num(general.command)),
        ("name", text(&general.name)),
        ("troops", list(general.troops.iter().map(|&t| num(t as f64)).collect())),
        ("n", num(general.n)),
        ("pct", num(general.pct)),
        ("at", text(&general.at)),
        ("doing", text(&general.doing)),
        ("cut", num(general.cut)),
        ("dug", num(general.dug)),
    ])
}

fn chosen_val(chosen: &Chosen) -> Val {
    Val::obj([
        ("index", num(chosen.index as f64)),
        ("order", chosen.order.clone()),
        ("objective", chosen.objective.clone()),
        ("way", chosen.way.clone()),
        ("troops", list(chosen.troops.iter().map(|&t| num(t as f64)).collect())),
        ("by", chosen.by.clone()),
        ("mark", chosen.mark.clone()),
    ])
}

fn opt<'a>(value: &'a Val, fallback: &'a Val) -> &'a Val {
    if value.is_undef() {
        fallback
    } else {
        value
    }
}

#[test]
fn command_matches_js() {
    let empty = Val::str("");
    let null = Val::Null;
    run(
        "command",
        &[
            ("commandCount", &|case| expect(case, num(command_count(case.arg(0).num())))),
            ("assignCommands", &|case| {
                let state = create_run(Val::Obj(js::Obj::new()), Box::new(NoHooks));
                let mut battle = battle_of(&state, &Val::Null);
                let source = case.arg(0);
                for side in 0..2 {
                    battle.troops[side] = source
                        .get("troops")
                        .at(side)
                        .array_or_empty()
                        .iter()
                        .map(|t| {
                            let mut troop = create_troop(TroopSeed { x: t.get("x").num(), y: t.get("y").num(), strength: t.get("strength").num(), owner: t.get("owner").num(), ..TroopSeed::default() });
                            troop.command = t.get("command").num();
                            troop
                        })
                        .collect();
                    battle.swarms[side] = match source.get("swarms").at(side) {
                        Val::Set(items) => items.iter().map(|item| item.num() as usize).collect(),
                        _ => Vec::new(),
                    };
                }
                assign_commands(&mut battle);
                let want = case.after.as_ref().map(|after| after[0].clone()).unwrap_or_else(|| source.clone());
                let mut verdict = Ok(());
                for side in 0..2 {
                    let got = list(battle.troops[side].iter().map(|t| num(t.command)).collect());
                    let wanted = list(want.get("troops").at(side).array_or_empty().iter().map(|t| t.get("command").clone()).collect());
                    if verdict.is_ok() {
                        verdict = same(&got, &wanted);
                    }
                }
                Some(verdict)
            }),
            ("readGenerals", &|case| expect(case, list(read_generals(case.arg(0)).iter().map(|names| list(names.iter().map(|n| text(n)).collect())).collect()))),
            ("readTalk", &|case| expect(case, list(read_talk(case.arg(0)).iter().map(|lines| list(lines.iter().map(talk_val).collect())).collect()))),
            ("generalsOf", &|case| expect(case, list(generals_of(case.arg(0), case.arg(1), opt(case.arg(2).get("member"), &empty)).iter().map(general_val).collect()))),
            ("commandOfTroops", &|case| expect(case, nums(&command_of_troops(case.arg(0), case.arg(1))))),
            ("nameGenerals", &|case| expect(case, name_generals(case.arg(0), case.arg(1), case.arg(2), case.arg(3).get("replace").truthy()))),
            ("orderTroops", &|case| {
                let options = case.arg(1);
                let ask = OrderAsk {
                    side: options.get("side"),
                    troops: options.get("troops"),
                    order: options.get("order"),
                    objective: opt(options.get("objective"), &empty),
                    way: opt(options.get("way"), &null),
                    by: opt(options.get("by"), &empty),
                    since: opt(options.get("since"), &empty),
                    mark: opt(options.get("mark"), &empty),
                };
                expect(case, order_troops(case.arg(0), &ask))
            }),
            ("releaseTroops", &|case| expect(case, release_troops(case.arg(0), case.arg(1).get("side"), case.arg(1).get("troops")))),
            ("returnTroops", &|case| {
                let options = case.arg(1);
                expect(case, return_troops(case.arg(0), options.get("side"), opt(options.get("by"), &empty), opt(options.get("since"), &empty)))
            }),
            ("ownTroopsOf", &|case| expect(case, list(own_troops_of(case.arg(0), case.arg(1), case.arg(2)).iter().map(|&t| num(t as f64)).collect()))),
            ("chosenOrdersOf", &|case| expect(case, list(chosen_orders_of(case.arg(0), case.arg(1)).iter().map(chosen_val).collect()))),
            ("releaseMarked", &|case| {
                let script = Script::new(case, "2");
                let got = release_marked(case.arg(0), case.arg(1), |mark| script.call(std::slice::from_ref(mark)).truthy());
                Some(expect(case, got)?.and_then(|_| script.done()))
            }),
            ("talkOf", &|case| expect(case, list(talk_of(case.arg(0), case.arg(1)).iter().map(talk_val).collect()))),
            ("withTalk", &|case| expect(case, with_talk(case.arg(0), case.arg(1), case.arg(2)))),
            ("routeAhead", &|case| expect(case, list(route_ahead(&points_of(case.arg(0)), case.arg(1).num(), case.arg(2).num()).iter().map(|p| nums(p)).collect()))),
            ("thinRoute", &|case| {
                let most = if case.arg(1).is_undef() { 12 } else { case.arg(1).num() as usize };
                expect(case, list(thin_route(&points_of(case.arg(0)), most).iter().map(|p| nums(p)).collect()))
            }),
        ],
    );
}
