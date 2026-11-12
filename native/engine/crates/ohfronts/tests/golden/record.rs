use crate::replay::read_val;
use crate::support::{self, *};
use ohfronts::sim::js::Val;
use ohfronts::sim::record::*;

fn records(list: Vec<Val>) -> Val {
    Val::Arr(list)
}

#[test]
fn record_matches_js() {
    support::run(
        "record",
        &[
            ("foldBattlefieldName", &|case| expect(case, text(&fold_battlefield_name(case.arg(0))))),
            ("normalizeBattlefield", &|case| expect(case, normalize_battlefield(case.arg(0)).unwrap_or(Val::Null))),
            ("normalizeBattlefields", &|case| expect(case, records(normalize_battlefields(case.arg(0))))),
            ("isWarIdName", &|case| expect(case, Val::Bool(is_war_id_name_of(case.arg(0), case.arg(1))))),
            ("plainFrontName", &|case| expect(case, text(&plain_front_name(case.arg(0))))),
            ("withWarIdFrontsRenamed", &|case| expect(case, with_war_id_fronts_renamed(case.arg(0)))),
            ("findBattlefield", &|case| expect(case, find_battlefield(case.arg(0), case.arg(1)).unwrap_or(Val::Null))),
            ("battlefieldSideOf", &|case| expect(case, num(battlefield_side_of(case.arg(0), case.arg(1))))),
            ("isOpenBattlefield", &|case| expect(case, Val::Bool(is_open_battlefield(case.arg(0))))),
            ("frontViewOf", &|case| {
                let got = match front_view_of(case.arg(0)) {
                    Some(view) => {
                        let troops = |side: usize| {
                            list(
                                view.troops[side]
                                    .iter()
                                    .map(|t| Val::obj([("x", num(t.x)), ("y", num(t.y)), ("strength", num(t.strength)), ("kind", num(t.kind as f64)), ("owner", num(t.owner as f64)), ("named", Val::Bool(t.named)), ("dig", num(t.dig)), ("state", num(t.state as f64))]))
                                    .collect(),
                            )
                        };
                        Val::obj([
                            ("name", view.name.clone()),
                            ("warId", view.war_id.clone()),
                            ("status", view.status.clone()),
                            ("sides", view.sides.clone()),
                            ("frame", view.frame.clone()),
                            ("named", view.named.clone()),
                            ("troops", list(vec![troops(0), troops(1)])),
                            ("commands", list(view.commands.to_vec())),
                            ("replay", view.replay.as_ref().map(read_val).unwrap_or(Val::Null)),
                            ("window", view.window.clone().map(|(from, until)| Val::obj([("from", from), ("until", until)])).unwrap_or(Val::Null)),
                        ])
                    }
                    None => Val::Null,
                };
                expect(case, got)
            }),
            ("battlefieldsAtDay", &|case| expect(case, records(battlefields_at_day(case.arg(0), case.arg(1), case.arg(2))))),
            ("battlefieldsAsSeen", &|case| expect(case, records(battlefields_as_seen(case.arg(0), case.arg(1), case.arg(2))))),
            ("holderAt", &|case| expect(case, holder_at(case.arg(0), case.arg(1).num(), case.arg(2).num()))),
        ],
    );
}
