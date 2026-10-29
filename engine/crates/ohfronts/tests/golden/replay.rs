use crate::support::*;
use ohfronts::sim::codec::Sample;
use ohfronts::sim::js::{Typed, Val};
use ohfronts::sim::replay::*;

fn finished_val(done: &Finished) -> Val {
    let mut out = Val::obj([
        ("d", text(&done.d)),
        ("n", num(done.n)),
        ("s", num(done.s)),
        ("e", num(done.e)),
        ("t", list(done.t.iter().map(|t| text(t)).collect())),
        ("names", list(done.names.iter().map(|n| text(n)).collect())),
        ("m", text(&done.m)),
        ("p", text(&done.p)),
    ]);
    if let (Some((first, turns)), Val::Obj(obj)) = (&done.shown, &mut out) {
        obj.set("o", list(first.iter().map(|(id, name)| list(vec![text(id), text(name)])).collect()));
        obj.set("f", list(turns.iter().map(|(day, id, name)| list(vec![num(*day), text(id), text(name)])).collect()));
    }
    out
}

fn bytes(value: &Val) -> Option<Vec<u8>> {
    if value.is_nullish() {
        None
    } else {
        Some(arg_numbers(value).iter().map(|&n| n as u8).collect())
    }
}

fn samples_val(samples: &[Sample]) -> Val {
    list(samples.iter().map(|s| Val::obj([("day", num(s.day)), ("x", num(s.x)), ("y", num(s.y)), ("strength", num(s.strength)), ("state", num(s.state as f64))])).collect())
}

fn step_of(value: &Val) -> Step {
    Step { day: value.get("day").num(), x: value.get("x").num(), y: value.get("y").num(), strength: value.get("strength").num(), state: value.get("state").num() }
}

#[test]
fn replay_matches_js() {
    run(
        "replay",
        &[
            ("createReplayRecorder", &|case| {
                let options = case.arg(0);
                if !options.get("from").is_nullish() {
                    return None;
                }
                let sides = if options.get("sides").is_undef() { list(vec![list(vec![]), list(vec![])]) } else { options.get("sides").clone() };
                let or_zero = |key: &str| if options.get(key).is_undef() { 0.0 } else { options.get(key).num() };
                let mut recorder = create_replay_recorder(&sides, or_zero("cols"), or_zero("rows"));
                for (index, (name, args, result)) in case.method_log.iter().enumerate() {
                    let arg = |at: usize| args.get(at).cloned().unwrap_or(Val::Undef);
                    match name.as_str() {
                        "record" => {
                            let troops: Vec<Vec<TrackIn>> = (0..2)
                                .map(|side| {
                                    arg(1).at(side).array_or_empty().iter().map(|t| TrackIn { strength: t.get("strength").num(), x: t.get("x").num(), y: t.get("y").num(), state: state_index(t.get("state")) }).collect()
                                })
                                .collect();
                            let ground_val = arg(2);
                            let holders = bytes(ground_val.get("holders"));
                            let homes = bytes(ground_val.get("homes"));
                            let painters = bytes(ground_val.get("painters"));
                            let when = if ground_val.get("when").is_nullish() { None } else { Some(arg_numbers(ground_val.get("when"))) };
                            let ground = holders.as_ref().filter(|_| ground_val.get("holders").truthy()).map(|holders| Ground { holders, homes: homes.as_deref(), painters: painters.as_deref(), when: when.as_deref() });
                            recorder.record(arg(0).num(), &troops, ground.as_ref());
                        }
                        "shown" => {
                            let was = arg(3);
                            recorder.shown(arg(0).num(), &arg(1), &arg(2), if was.is_undef() { None } else { Some(&was) });
                        }
                        "finish" => {
                            let options = arg(0);
                            let date = if options.get("date").is_undef() { Val::str("") } else { options.get("date").clone() };
                            if let Err(error) = same(&finished_val(&recorder.finish(&date, options.get("days"))), result) {
                                return Some(Err(format!("finish at {index}: {error}")));
                            }
                        }
                        _ => {}
                    }
                }
                Some(Ok(()))
            }),
            ("normalizeReplay", &|case| expect(case, normalize_replay(case.arg(0)).unwrap_or(Val::Null))),
            ("replayBetween", &|case| expect(case, replay_between(case.arg(0), case.arg(1).num(), case.arg(2).num()))),
            ("shownOwnersAt", &|case| expect(case, shown_owners_at(case.arg(0), case.arg(1).num()).map(Val::Obj).unwrap_or(Val::Null))),
            ("replayDayOn", &|case| expect(case, replay_day_on(case.arg(0), case.arg(1)).map(num).unwrap_or(Val::Null))),
            ("replayOf", &|case| {
                let got = match replay_of(case.arg(0)) {
                    Some(read) => Val::obj([
                        ("date", read.date.clone()),
                        ("days", read.days.clone()),
                        ("start", read.start.clone()),
                        ("end", read.end.clone()),
                        ("tracks", list(read.tracks.iter().map(|side| list(side.iter().map(|s| samples_val(s)).collect())).collect())),
                        (
                            "paint",
                            Val::obj([
                                ("names", read.names.clone()),
                                ("began", u8s(read.began.clone())),
                                ("ticks", Val::Typed(Typed::U32(read.paint.ticks.clone()))),
                                ("cells", Val::Typed(Typed::U16(read.paint.cells.clone()))),
                                ("states", u8s(read.paint.states.clone())),
                            ]),
                        ),
                    ]),
                    None => Val::Null,
                };
                expect(case, got)
            }),
            ("replayWindowOf", &|case| expect(case, replay_window_of(case.arg(0)).map(|(from, until)| Val::obj([("from", from), ("until", until)])).unwrap_or(Val::Null))),
            ("stillReplayOf", &|case| expect(case, still_replay_of(case.arg(0)))),
            ("trackAt", &|case| {
                if case.arg(0).is_nullish() {
                    return expect(case, Val::Null);
                }
                let track: Vec<Step> = case.arg(0).array_or_empty().iter().map(step_of).collect();
                let got = track_at(&track, case.arg(1).num()).map(|at| Val::obj([("x", num(at.x)), ("y", num(at.y)), ("strength", num(at.strength)), ("state", num(at.state)), ("moving", Val::Bool(at.moving))]));
                expect(case, got.unwrap_or(Val::Null))
            }),
        ],
    );
}
