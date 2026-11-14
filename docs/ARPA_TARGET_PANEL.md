# ARPA Target Information Panel

The Radar/ARPA console includes a Transas Navi-Sailor-inspired target information panel:
- Target tabs and a Multiple view.
- ARPA source/status, CPA, TCPA, true bearing, range, estimated course and speed over ground.
- Bow Crossing Range (BCR) and Bow Crossing Time (BCT).
- Selecting a row selects the corresponding radar target; individual target view allows cancellation.

## Calculation basis

CPA/TCPA uses the target velocity estimated from successive radar measurements and own-ship course/speed. BCR/BCT is calculated geometrically as the target crossing the infinite line through own ship in the current heading direction. BCR is signed along that line (positive ahead, negative astern); BCT is signed (negative means the crossing is in the past). If the target is not tracked or its relative cross-track velocity is effectively zero, the values are unavailable.

The current simulator does not model AIS data, AIS/ARPA association, separate STW/CTW sensors, or external ARPA sources. Therefore the panel shows COG/SOG derived from the ARPA radar track rather than presenting unsupported STW/CTW values. AIS filter is visibly disabled until an AIS data source exists.

## Limitations

This is a training implementation inspired by the information hierarchy of commercial marine displays, not a copy of proprietary Transas software or a certified ARPA implementation. The association and tracking algorithms remain simplified educational models. Values must not be used for real navigation.


## Target Information menu

The arrow in the Targets Information title bar opens a navigation menu:
- Targets overview: individual target tabs and Multiple view.
- CPA/TCPA: current closest-approach solution for the selected ARPA track.
- BCR/BCT: bow-crossing prediction.
- Past positions: measured history retained by the ARPA track.
- ARPA tracking: track status and scan count.
- Trial manoeuvre: dynamic own-ship trial settings and predicted CPA/TCPA.
- AIS data is shown as unavailable because the simulator has no AIS input stream.

## Dynamic Trial Manoeuvre model

The dynamic trial prediction is calculated independently of live ship state:
1. Own ship continues on its current course and speed during the configured delay.
2. After the delay, course changes toward the requested course at the configured ROT.
3. Speed changes toward the requested speed using separate acceleration and deceleration rates.
4. Each target continues on its latest measured ARPA velocity; the live ARPA tracking process continues updating independently.
5. Relative separation is evaluated at one-second intervals over the configured vector horizon. The minimum predicted separation and its time are reported as trial DCPA/TCPA.

This is a deterministic educational model. It does not reproduce a specific manufacturer algorithm, vessel-specific manoeuvring booklet, rudder response, drift, current, wind, or turning-circle model. Trial results are not for real navigation.


## Targets Information selector (v0.23.5)

The title-bar arrow opens a menu. Each menu choice displays one instrument block at a time; no separate block is inserted outside this selector.

Available pages:
- Target Information: Multiple overview and an individual target readout with source/status, range, true bearing, DCPA, TCPA, estimated COG/SOG, BCR/BCT, scan count, last scan time, and target-swap count.
- CPA/TCPA: current closest-approach solution for the selected ARPA track.
- BCR/BCT: bow-crossing prediction.
- Past Positions: measured positions retained by the selected ARPA track.
- ARPA Tracking: acquisition/tracking/lost state and scan count.
- Trial Manoeuvre: dynamic own-ship trial settings and predicted DCPA/TCPA.
- COLREG Assessment, ARPA Targets, ARPA Display, and Autopilot remain available in the same menu.

## Acquisition and tracking

Manual acquisition starts in ACQ with the first measured radar position. The track remains ACQ through the first two observations and enters TRACK after the third valid radar observation, when a velocity estimate can be formed from a short measured history. The position history is bounded to the newest eight samples, while the total observation count continues increasing. A track becomes LOST after three missed 2.5-second radar sweeps (7.5 seconds). Reacquisition by the same echo ID starts a fresh ACQ history; stale velocity is not carried over.

The association model uses predicted target position and one-to-one global assignment to avoid assigning one radar echo to multiple active tracks. Target Swap is reported when the associated echo identity changes. This remains a deterministic educational association model and is not a certified ARPA tracker.

## Limitations

All displayed values are training data derived from simulated radar measurements. CPA/TCPA assumes constant current velocities; Trial Manoeuvre uses a separate simplified turn-rate/acceleration model. Wind, current, leeway, sensor fusion, AIS, real radar clutter, sea/rain clutter controls, and manufacturer-specific tracking filters are not represented. The simulator is not certified and must not be used for real navigation.


## Automatic Trial Manoeuvre ROT (v0.23.6)

The manual ROT input has been removed from both Trial Manoeuvre interfaces. ROT is now estimated from the current own-ship speed and the simulator's simplified ship model: reference speed, speed-squared rudder effectiveness, and maximum turn rate at hard-over rudder. The readout updates automatically as own-ship speed changes. It is a model estimate, not a value from a real vessel's manoeuvring booklet; at very low speed a 0.1°/min display floor is used to keep the trial solver numerically usable.


## ECDIS chart and route safety improvements (v0.23.7)

- The chart follows own ship while remaining North Up. Route points remain in the same local coordinate frame; chart clicks are converted from the moving viewport back to world coordinates.
- Depth is reported as unknown outside explicit chart coverage; land is not reported as water depth.
- Route assessment flags uncharted route segments as unsafe/unknown instead of assuming 40 m depth. The training chart includes a synthetic 40 m charted-water area with shallower patches overlaid.
- These checks use a simplified synthetic chart and sampled route segments; they are not an ENC safety contour or a navigational safety guarantee.
