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


## Unified Targets Information panel (v0.23.1)

The title-bar arrow expands or collapses one integrated information area. It does not navigate between separate pages. The expanded area stacks all target-data blocks in one continuous panel:
- Target overview and multi-target table.
- Selected-target CPA/TCPA and current bearing/range.
- BCR/BCT.
- Past measured positions.
- ARPA tracking status for every acquired target.
- Dynamic Trial Manoeuvre settings and predicted CPA/TCPA.
- AIS availability status.

Selecting a target in the overview or tracking list updates the selected-target-dependent blocks together. The panel uses Russian labels; standard maritime abbreviations and units are retained. All blocks are visible in the same expanded area.
