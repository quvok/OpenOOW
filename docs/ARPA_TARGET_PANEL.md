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
