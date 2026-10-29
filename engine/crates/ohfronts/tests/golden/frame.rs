use crate::support::*;
use ohfronts::sim::frame::*;
use ohfronts::sim::js::Val;

pub fn frame_of(value: &Val) -> Frame {
    Frame {
        lng0: value.get("lng0").num(),
        lat0: value.get("lat0").num(),
        cell: value.get("cell").num(),
        cols: value.get("cols").num(),
        rows: value.get("rows").num(),
        km: value.get("km").num(),
        flat: value.get("flat").truthy(),
        scale: if value.get("scale").truthy() { value.get("scale").num() } else { KM_PER_DEGREE },
    }
}

pub fn frame_val(frame: &Frame) -> Val {
    let mut out = Val::obj([
        ("lng0", num(frame.lng0)),
        ("lat0", num(frame.lat0)),
        ("cell", num(frame.cell)),
        ("cols", num(frame.cols)),
        ("rows", num(frame.rows)),
        ("km", num(frame.km)),
    ]);
    if frame.flat {
        if let Val::Obj(obj) = &mut out {
            obj.set("flat", Val::Bool(true));
            obj.set("scale", num(frame.scale));
        }
    }
    out
}

fn opt_frame(frame: Option<Frame>) -> Val {
    frame.as_ref().map(frame_val).unwrap_or(Val::Null)
}

fn bounds_val(bounds: Bounds) -> Val {
    Val::obj([("west", num(bounds.west)), ("south", num(bounds.south)), ("east", num(bounds.east)), ("north", num(bounds.north))])
}

#[test]
fn frame_matches_js() {
    run(
        "frame",
        &[
            ("latToY", &|case| expect(case, num(lat_to_y(case.arg(0).num())))),
            ("yToLat", &|case| expect(case, num(y_to_lat(case.arg(0).num())))),
            ("unwrapLng", &|case| {
                let around = if case.arg(1).is_undef() { 0.0 } else { case.arg(1).num() };
                expect(case, num(unwrap_lng(case.arg(0).num(), around)))
            }),
            ("homeLng0", &|case| expect(case, num(home_lng0(case.arg(0).num(), case.arg(1).num())))),
            ("createFrame", &|case| {
                let bounds = case.arg(0);
                let options = case.arg(1);
                let flat = !options.get("flat").is_undef() && options.get("flat").truthy();
                let scale = if options.get("scale").is_undef() { KM_PER_DEGREE } else { options.get("scale").num() };
                let margin = if options.get("marginKm").is_undef() { 0.0 } else { options.get("marginKm").num() };
                let made = create_frame(
                    Bounds { west: bounds.get("west").num(), south: bounds.get("south").num(), east: bounds.get("east").num(), north: bounds.get("north").num() },
                    flat,
                    scale,
                    margin,
                );
                expect(case, opt_frame(made))
            }),
            ("normalizeFrame", &|case| expect(case, opt_frame(normalize_frame(case.arg(0))))),
            ("projectorOf", &|case| {
                let projector = projector_of(&frame_of(case.arg(0)));
                expect(case, Val::obj([("rowKm", f64s(projector.row_km))]))
            }),
            ("frameBounds", &|case| expect(case, bounds_val(frame_bounds(&frame_of(case.arg(0)))))),
            ("pointInFrame", &|case| expect(case, Val::Bool(point_in_frame(&frame_of(case.arg(0)), case.arg(1).num(), case.arg(2).num())))),
            ("cellIndexAt", &|case| expect(case, num(cell_index_at(&frame_of(case.arg(0)), case.arg(1).num(), case.arg(2).num())))),
        ],
    );
}
