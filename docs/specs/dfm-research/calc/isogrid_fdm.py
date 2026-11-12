"""Isogrid vs FDM wall: bending stiffness, mass, rough print time. All per unit width, smeared.
E normalized to 1 = along-bead modulus of fully dense printed material (PLA about 3.0-3.5 GPa).
Poisson effects ignored (same factor for all layers), so D values are E*I per unit width, ratios only."""
import math

RHO_PLA = 1.24e-3  # g/mm^3
W = 0.45           # line width mm
LH = 0.2           # layer height mm

def layered_D(layers):
    """layers: list of (thickness, modulus) bottom to top. Returns (D, z_na, total_EA)."""
    z = 0.0; EA = 0.0; ES = 0.0; segs = []
    for t, E in layers:
        segs.append((z, z + t, E)); EA += E * t; ES += E * t * (z + t / 2); z += t
    zn = ES / EA
    D = sum(E * ((z1 - zn) ** 3 - (z0 - zn) ** 3) / 3 for z0, z1, E in segs)
    return D, zn, z

# --- check against NASA CR-124075: D/D_skin = beta^2/(1+alpha) when rib and skin share E
def nasa_ratio(t, b, d, h):
    a = b * d / (t * h); dl = d / t
    beta = math.sqrt(3 * a * (1 + dl) ** 2 + (1 + a) * (1 + a * dl ** 2))
    return beta ** 2 / (1 + a), a, beta

def iso_layers(t, b, d, h, Es, Er):
    return [(t, Es), (d, Er * b / h)]  # grid smeared modulus (b/h)E (NASA p. 2.0.020)

def fillet_extra(b, d, h, r_pocket, r_root):
    """extra volume per area (mm) from pocket corner fillets (60 deg corners) and rib-root fillets"""
    pockets = math.sqrt(3) / h ** 2               # triangles per mm^2
    corner = (math.sqrt(3) - math.pi / 3) * r_pocket ** 2   # area added in one 60-deg corner
    pocket_fill = pockets * 3 * corner * d
    root = (3 / h) * 2 * (1 - math.pi / 4) * r_root ** 2    # two root fillets per rib, 90-deg corners
    return pocket_fill + root

def iso_mass_thk(t, b, d, h, r_pocket, r_root):
    return t + 3 * b * d / h + fillet_extra(b, d, h, r_pocket, r_root)

def core_E(rho, kind):
    if kind == "gyroid":   # bending-dominated fit to Bean et al. 2022 PLA gyroid (22% -> 6.3%, 25% -> 8.3%)
        return 1.3 * rho ** 2
    if kind == "grid_hi":  # optimistic: half the lines aligned with the load, stretch-dominated
        return 0.5 * rho
    raise ValueError

def core_G(rho, kind):
    Gs = 1 / (2 * 1.35)
    if kind == "gyroid":
        return 0.375 * core_E(rho, kind)
    return 0.3 * rho * Gs  # vertical walls of grid lines, with knockdown

def sandwich(T, ttop, tbot, rho_nom, kind, Ek_skin):
    rho = min(1.0, rho_nom * 1.10)  # CNC Kitchen: 30% nominal weighed about 33%
    c = T - ttop - tbot
    D, zn, _ = layered_D([(tbot, Ek_skin), (c, core_E(rho, kind)), (ttop, Ek_skin)])
    dsk = T - (ttop + tbot) / 2
    S = core_G(rho, kind) * dsk ** 2 / c
    m = ttop + tbot + rho * c
    return dict(D=D, S=S, m=m, zmax=max(zn, T - zn), rho=rho)

def isogrid(t, b, d, h, Ek_skin, Ek_rib, r_pocket=None, r_root=None):
    r_pocket = b if r_pocket is None else r_pocket
    r_root = 0.5 * b if r_root is None else r_root
    D, zn, T = layered_D(iso_layers(t, b, d, h, Ek_skin, Ek_rib))
    Gs = 1 / (2 * 1.35)
    S = Gs * (1.5 * b / h) * d + Gs * Ek_skin * t * 5 / 6  # rib webs (3 families, cos^2 sum 3/2) + skin
    m = iso_mass_thk(t, b, d, h, r_pocket, r_root)
    return dict(D=D, S=S, m=m, zn=zn, ztip=T - zn, zskin=zn)

def solid(T, Ek):
    D = Ek * T ** 3 / 12
    return dict(D=D, S=(1 / 2.7) * Ek * T * 5 / 6, m=T, zmax=T / 2)

def defl_center(D, S, L):  # simply supported strip, center line load P=1 per width
    return L ** 3 / (48 * D) + L / (4 * S)

def thk_for_D(Dtarget, f):  # bisection on thickness for a function f(T)->D
    lo, hi = 0.1, 50
    for _ in range(80):
        mid = (lo + hi) / 2
        if f(mid) < Dtarget: lo = mid
        else: hi = mid
    return (lo + hi) / 2

print("NASA check (t=1.2,b=0.9,d=4,h=15):", nasa_ratio(1.2, 0.9, 4, 15)[0],
      "layered:", layered_D(iso_layers(1.2, 0.9, 4, 15, 1, 1))[0] / (1.2 ** 3 / 12))

GEOMS = {
    "G1 lid 150x100, T=4": dict(L=100, A=(150, 100), T=4.0, t=1.2, b=1.25, h=15),
    "G2 panel 250x200, T=6": dict(L=200, A=(250, 200), T=6.0, t=1.2, b=1.25, h=20),
    "G2b panel 250x200, T=6, b=1.7, t=1.6, h=25": dict(L=200, A=(250, 200), T=6.0, t=1.6, b=1.7, h=25),
}
KS, KR, K100 = 0.85, 0.95, 0.85  # rastered skin, rib along bead, 100% rastered solid
TTOP, TBOT = 1.0, 0.8            # 5 top layers, 4 bottom layers at 0.2 mm

for name, g in GEOMS.items():
    T, t, b, h, L = g["T"], g["t"], g["b"], g["h"], g["L"]
    d = T - t
    print("\n==", name, f"| skin t={t}, rib b={b}, d={d:.1f}, h={h}, d/b={d/b:.2f}, alpha={b*d/(t*h):.3f}, cells across short span={L/h:.1f}")
    iso = isogrid(t, b, d, h, KS, KR)
    iso_iso = isogrid(t, b, d, h, 1, 1, 0, 0)  # NASA idealization: isotropic, no fillets
    rows = []
    rows.append(("(a) isotropic solid T", solid(T, 1.0)))
    rows.append(("(a) isotropic isogrid T (no fillets)", iso_iso))
    tb = iso_iso["m"]
    rows.append((f"(b) isotropic solid of equal mass ({tb:.2f} mm)", solid(tb, 1.0)))
    for kind in ("gyroid", "grid_hi"):
        for rn in (0.10, 0.15, 0.20):
            rows.append((f"(c) FDM sandwich T, {int(rn*100)}% {kind}", sandwich(T, TTOP, TBOT, rn, kind, KS)))
    rows.append(("(c/d/e) FDM isogrid T (with fillets)", iso))
    rows.append(("(d) FDM 100% infill T", solid(T, K100)))
    rows.append((f"(e) bare skin t={t}", solid(t, KS)))
    tm = iso["m"]
    rows.append((f"(e') solid printed wall of isogrid mass ({tm:.2f} mm)", solid(tm, K100)))
    ref = iso["D"]
    print(f"{'case':58s} {'D/D_iso':>8s} {'mass/iso':>8s} {'eq thk mm':>9s} {'g':>6s} {'defl/iso':>8s} {'shear%':>6s}")
    Aarea = g["A"][0] * g["A"][1]
    for lab, r in rows:
        dfl = defl_center(r["D"], r["S"], L); dfl_iso = defl_center(iso["D"], iso["S"], L)
        sh = (L / (4 * r["S"])) / dfl * 100
        print(f"{lab:58s} {r['D']/ref:8.2f} {r['m']/iso['m']:8.2f} {r['m']:9.2f} {r['m']*Aarea*RHO_PLA:6.1f} {dfl/dfl_iso:8.2f} {sh:6.1f}")
    # equal-stiffness sandwich: thickness and mass needed to match the isogrid
    for rn in (0.10, 0.15, 0.20):
        f = lambda TT: sandwich(TT, TTOP, TBOT, rn, "gyroid", KS)["D"] if TT > TTOP + TBOT + 0.05 else KS * TT ** 3 / 12
        Teq = thk_for_D(ref, f)
        msw = sandwich(Teq, TTOP, TBOT, rn, "gyroid", KS)["m"] if Teq > TTOP + TBOT + 0.05 else Teq
        print(f"   equal-D sandwich ({int(rn*100)}% gyroid): T={Teq:.2f} mm, mass/iso={msw/iso['m']:.2f}")
    Teq_solid = (12 * ref / K100) ** (1 / 3)
    print(f"   equal-D 100% printed wall: T={Teq_solid:.2f} mm, mass/iso={Teq_solid/iso['m']:.2f}")
    # break-even cell height for material vs a sandwich of the same T
    f_ex = fillet_extra(b, d, h, b, 0.5 * b) / (3 * b * d / h)
    for rn in (0.10, 0.15, 0.20):
        rho = rn * 1.1
        denom = (TTOP + TBOT - t) + rho * (T - TTOP - TBOT)
        hstar = 3 * b * d * (1 + f_ex) / denom
        print(f"   material break-even cell h* vs {int(rn*100)}% sandwich: {hstar:.1f} mm (isogrid lighter if h > h*)")
    # strength proxy: moment at first failure, allowable along bead = 1, rastered +-45 skin = 0.62 (Ahn 2002)
    sw = sandwich(T, TTOP, TBOT, 0.15, "gyroid", KS)
    M_sw = 0.62 * sw["D"] / (KS * sw["zmax"])
    M_iso_tip = 1.0 * iso["D"] / (KR * iso["ztip"])      # rib tip governs (along bead)
    M_iso_skin = 0.62 * iso["D"] / (KS * iso["zskin"])
    print(f"   strength proxy M_fail/M_fail(sandwich15): isogrid rib-tip {M_iso_tip/M_sw:.2f}, skin {M_iso_skin/M_sw:.2f}; neutral axis {iso['zn']:.2f} mm above skin face")
    # rib crippling (free top edge, plate with one free edge, k=0.43), PLA E=3200, strength 50 MPa
    scr = 0.43 * math.pi ** 2 * 3200 / (12 * (1 - 0.35 ** 2)) * (b / d) ** 2
    print(f"   rib local buckling stress ~ {scr:.0f} MPa (vs about 50 MPa PLA strength); d/b limit for scr>=50: {math.sqrt(0.43*math.pi**2*3200/(12*(1-0.35**2))/50):.1f}")
    # rough print time: path length / speed + starts * overhead
    area = Aarea
    def t_sandwich(rn):
        rho = rn * 1.1; c = T - TTOP - TBOT
        solid_len = (TTOP + TBOT) * area / (W * LH)
        sparse_len = rho * c * area / (W * LH)
        per_len = 2 * 2 * (g["A"][0] + g["A"][1]) * T / LH  # 2 perimeters around outline
        return solid_len / 200 + sparse_len / 250 + per_len / 150, int(T / LH)
    def t_iso():
        skin_len = t * area / (W * LH)
        rib_len = (iso["m"] - t) * area / (W * LH)
        pockets = math.sqrt(3) / h ** 2 * area
        starts = pockets * d / LH
        per_len = 2 * 2 * (g["A"][0] + g["A"][1]) * T / LH
        # ribs: short loops, acceleration-limited; assume 120 mm/s effective, 0.25 s per loop start (travel, retract, seam)
        return skin_len / 200 + rib_len / 120 + per_len / 150 + starts * 0.25, int(starts)
    ts, _ = t_sandwich(0.15); ti, st = t_iso()
    print(f"   rough time: sandwich 15% {ts/60:.0f} min, isogrid {ti/60:.0f} min ({st} pocket-loop starts)")

# Case (e) sweep: add ribs to a floppy skin
print("\n== (e) ribs on a 1.2 mm skin, b=1.25, h=15")
for d in (1.0, 1.8, 2.8, 4.0, 4.8):
    r = isogrid(1.2, 1.25, d, 15, KS, KR); s = solid(1.2, KS)
    print(f"  d={d}: D/D_skin={r['D']/s['D']:.1f}, mass/skin={r['m']/1.2:.2f}, D per mass vs skin={r['D']/s['D']/(r['m']/1.2):.1f}")
