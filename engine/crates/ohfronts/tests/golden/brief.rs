use crate::air::{battle_wings_of, flying_alive};
use crate::fronts::*;
use crate::support::{self, *};
use ohfronts::sim::brief::*;
use ohfronts::sim::js::{OrdMap, Val};

#[test]
fn brief_matches_js() {
    support::run(
        "brief",
        &[
            ("buildBrief", &|case| {
                let run = bare_run();
                let value = case.arg(0);
                let mut battle = pick_battle(&run, value);
                battle.wings = battle_wings_of(value.get("wings"));
                if let Some(field) = battle.field.as_mut() {
                    field.arena = battle.arena.clone();
                }
                for side in 0..2 {
                    if let Val::Str(mission) = value.get("airMission").at(side) {
                        battle.air_mission[side] = mission.clone();
                    }
                    battle.taken[side] = value.get("taken").at(side).array_or_empty().to_vec();
                    battle.cities_taken[side] = value.get("citiesTaken").at(side).array_or_empty().to_vec();
                }
                if value.get("startHolders").is_object() {
                    battle.start_holders = Some(bytes(value.get("startHolders")));
                }
                if let Val::Obj(skies) = value.get("skies") {
                    let mut book = OrdMap::new();
                    for (state, count) in skies.entries() {
                        book.set(state.to_string(), count.num());
                    }
                    battle.skies = Some(book);
                }
                let alive = flying_alive(value.get("wings"));
                expect(case, build_brief(&mut battle, case.arg(1), &|id| alive.iter().any(|known| known == id)))
            }),
            ("describeSince", &|case| {
                let most = match case.arg(1).get("most") {
                    Val::Undef => 4,
                    other => other.num() as usize,
                };
                let got = describe_since(case.arg(0), most);
                expect(case, Val::obj([("since", text(&got.since)), ("text", text(&got.text)), ("moved", Val::Bool(got.moved))]))
            }),
            ("skyStrongerNote", &|case| expect(case, text(sky_stronger_note(case.arg(0), case.arg(1))))),
            ("describeBattlefield", &|case| {
                let max = if case.arg(1).get("max").is_undef() { ohfronts::sim::constants::BRIEF_TEXT_MAX } else { case.arg(1).get("max").num() };
                expect(case, text(&describe_battlefield_within(case.arg(0), case.arg(1).get("viewer"), max)))
            }),
        ],
    );
}
