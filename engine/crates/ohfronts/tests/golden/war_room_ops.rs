use crate::support::{self, *};
use ohfronts::sim::js::Val;
use ohfronts::sim::war_room_ops::*;

#[test]
fn war_room_ops_match_js() {
    support::run(
        "warRoomOps",
        &[
            ("cleanWarRoomOp", &|case| expect(case, clean_war_room_op(case.arg(0)))),
            ("applyWarRoomOp", &|case| {
                let options = case.arg(2);
                let or = |key: &str, otherwise: Val| match options.get(key) {
                    Val::Undef => otherwise,
                    other => other.clone(),
                };
                let era = match options.get("era") {
                    Val::Num(era) => Some(*era),
                    _ => None,
                };
                let got = match apply_war_room_op(case.arg(0), case.arg(1), &or("player", text("")), &or("date", text("")), &or("transports", Val::Arr(Vec::new())), era) {
                    Applied::Error(error) => Val::obj([("error", text(error))]),
                    Applied::Battlefields { battlefields, record, side, transports } => match transports {
                        Some(transports) => Val::obj([("battlefields", list(battlefields)), ("record", record), ("side", num(side as f64)), ("transports", transports)]),
                        None => Val::obj([("battlefields", list(battlefields)), ("record", record), ("side", num(side as f64))]),
                    },
                };
                expect(case, got)
            }),
        ],
    );
}
