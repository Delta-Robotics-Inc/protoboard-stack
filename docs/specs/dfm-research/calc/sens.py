import importlib.util, sys, io, contextlib
spec = importlib.util.spec_from_file_location("m", "isogrid_fdm.py"); m = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()): spec.loader.exec_module(m)
print("Sensitivity: D_sandwich(15% gyroid)/D_isogrid at equal T")
for T,t,b,h in [(4,1.2,1.25,15),(4,1.2,1.25,10),(4,1.2,0.9,15),(6,1.2,1.25,20),(6,1.2,1.7,12),(10,1.2,1.7,20),(10,1.6,2.0,15)]:
    d=T-t
    for ks_sw, ttop, tbot, lab in [(0.85,1.0,0.8,"base"),(0.6,1.0,0.8,"weak skins 0.6"),(0.85,0.6,0.6,"thin skins 3+3 layers"),(0.5,0.6,0.6,"thin+weak")]:
        sw=m.sandwich(T,ttop,tbot,0.15,"gyroid",ks_sw); iso=m.isogrid(t,b,d,h,0.85,1.0)
        print(f"T={T} t={t} b={b} h={h} d/b={d/b:.1f} [{lab:22s}] D ratio={sw['D']/iso['D']:.2f} mass ratio={sw['m']/iso['m']:.2f}")
print()
print("Shear share of center deflection vs span, G1 sandwich 10% gyroid vs isogrid")
sw=m.sandwich(4,1.0,0.8,0.10,"gyroid",0.85); iso=m.isogrid(1.2,1.25,2.8,15,0.85,0.95)
for L in (20,30,50,100):
    for lab,r in (("sandwich",sw),("isogrid",iso)):
        b_=L**3/(48*r['D']); s_=L/(4*r['S'])
        print(f" L={L} {lab}: shear {100*s_/(b_+s_):.0f}%  total defl {b_+s_:.3g}")
    print(f"  defl ratio sandwich/isogrid = {(L**3/(48*sw['D'])+L/(4*sw['S']))/(L**3/(48*iso['D'])+L/(4*iso['S'])):.2f}")
# closed isogrid core: sandwich whose core is triangle walls, b=0.9, h=15, full density walls
print()
for T in (4,6):
    c=T-1.8; rho_c=3*0.9/15
    D,zn,_=m.layered_D([(0.8,0.85),(c,0.95*0.9/15),(1.0,0.85)])
    iso=m.isogrid(1.2,1.25,T-1.2,15 if T==4 else 20,0.85,0.95)
    mass=1.8+rho_c*c
    print(f"T={T}: closed isogrid core (b=0.9,h=15) D/D_open_iso={D/iso['D']:.2f}, mass/iso={mass/iso['m']:.2f}")
