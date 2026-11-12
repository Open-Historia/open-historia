use super::constants::{edge_of, Edge, SHORTAGE_EDGE};
use super::js::{fold, Val};
use std::collections::HashSet;

pub const FAIR_EDGE: Edge = Edge { power: 1.0, pace: 1.0, reserves: 1.0, mend: 1.0 };

pub fn difficulty_edge(difficulty: &Val) -> Option<Edge> {
    let id = fold(difficulty);
    if id == "medium" {
        return None;
    }
    edge_of(&id)
}

pub fn edge_of_difficulty(difficulty: &Val) -> Edge {
    difficulty_edge(difficulty).unwrap_or(FAIR_EDGE)
}

pub fn weighed_side(sides: &Val, players: &Val) -> f64 {
    let played: HashSet<String> = players.array_or_empty().iter().map(fold).filter(|name| !name.is_empty()).collect();
    if played.is_empty() {
        return -1.0;
    }
    let has = |side: usize| sides.get(&side.to_string()).array_or_empty().iter().any(|member| played.contains(&fold(member)));
    let (a, b) = (has(0), has(1));
    if a == b {
        -1.0
    } else if a {
        1.0
    } else {
        0.0
    }
}

pub fn short_edge(edge: Edge, shortage: f64) -> Edge {
    if !(shortage > 0.0) {
        return edge;
    }
    let by = if shortage > 1.0 { 1.0 } else { shortage };
    Edge {
        power: edge.power * (1.0 - SHORTAGE_EDGE.power * by),
        pace: edge.pace * (1.0 - SHORTAGE_EDGE.pace * by),
        reserves: edge.reserves * (1.0 - SHORTAGE_EDGE.reserves * by),
        mend: edge.mend * (1.0 - SHORTAGE_EDGE.mend * by),
    }
}

pub fn side_shortage<S, W>(members: &[Val], shortage_of: Option<S>, strength_of: Option<W>) -> f64
where
    S: Fn(&Val) -> f64,
    W: Fn(&Val) -> f64,
{
    let shortage_of = match shortage_of {
        Some(shortage_of) => shortage_of,
        None => return 0.0,
    };
    let mut weight = 0.0;
    let mut short = 0.0;
    for member in members {
        let brings = match &strength_of {
            Some(strength_of) => strength_of(member),
            None => 1.0,
        };
        let worth = if brings > 0.0 { brings } else { 1.0 };
        let lacks = shortage_of(member);
        weight += worth;
        if lacks > 0.0 {
            short += worth * if lacks > 1.0 { 1.0 } else { lacks };
        }
    }
    if weight > 0.0 {
        short / weight
    } else {
        0.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Handicap {
    pub side: f64,
    pub edge: Edge,
    pub edges: [Edge; 2],
}

pub fn handicap_of(difficulty: &Val, sides: &Val, players: &Val) -> Handicap {
    let edge = difficulty_edge(difficulty);
    let side = match edge {
        None => -1.0,
        Some(_) => weighed_side(sides, players),
    };
    let edge = edge.unwrap_or(FAIR_EDGE);
    Handicap {
        side,
        edge: if side < 0.0 { FAIR_EDGE } else { edge },
        edges: [if side == 0.0 { edge } else { FAIR_EDGE }, if side == 1.0 { edge } else { FAIR_EDGE }],
    }
}
