"""Build original, reusable game assets. Run with Blender --background --python scripts/build-assets.py."""
import bpy, math, random, os
from mathutils import Vector
random.seed(82)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
OUT=os.path.abspath(os.path.join(os.path.dirname(__file__), '../public/models'))
os.makedirs(OUT, exist_ok=True)
def mat(name, color, rough=.6, metal=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Roughness'].default_value=rough; p.inputs['Metallic'].default_value=metal
    return m
fabric=mat('Woven olive cotton',(.25,.29,.20),.94)
rockmat=mat('Weathered coastal granite',(.29,.27,.23),.96)
leaf=mat('Coastal foliage',(.10,.20,.055),.86)
rubber=mat('Tire rubber',(.018,.021,.023),.91)
alloy=mat('Brushed alloy',(.55,.59,.62),.23,.92)
black=mat('Brake disc',(.09,.10,.11),.5,.8)
denim=mat('Indigo canvas',(.055,.105,.13),.95)
# Bake repeatable fabric weave into portable image textures, not Blender-only shaders.
for material, base in [(fabric,(.25,.29,.20)),(denim,(.055,.105,.13))]:
    image=bpy.data.images.new(material.name+' weave',width=256,height=256)
    pixels=[]
    for y in range(256):
        for x in range(256):
            grain=.82+random.random()*.12+(.13 if (x+y//2)%4<2 else 0)
            pixels.extend([*(v*grain for v in base),1])
    image.pixels=pixels; image.pack()
    node=material.node_tree.nodes.new('ShaderNodeTexImage'); node.image=image
    material.node_tree.links.new(node.outputs['Color'],material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
def pos(v): return (v[0],-v[2],v[1])
def group(name):
    g=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(g); return g
def finish(o,name,g,m):
    o.name=name; o.parent=g; o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth=True
    return o
def ell(name,g,m,p,s):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8 if m == leaf else 24,ring_count=6 if m == leaf else 16,location=pos(p)); o=bpy.context.object; o.scale=(s[0],s[2],s[1]); return finish(o,name,g,m)
def cube(name,g,m,p,s,bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos(p)); o=bpy.context.object; o.scale=(s[0],s[2],s[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mod=o.modifiers.new('Soft manufactured edges','BEVEL'); mod.width=bevel; mod.segments=3
    bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o,name,g,m)
def loft(name,g,m,rings):
    verts=[]; faces=[]; n=24
    for y,w,d in rings:
        for i in range(n):
            a=i*math.tau/n; verts.append(pos((math.cos(a)*w,y,math.sin(a)*d)))
    for j in range(len(rings)-1):
        for i in range(n):
            a=j*n+i; b=j*n+(i+1)%n; faces.append((a,b,b+n,a+n))
    faces.extend([tuple(reversed(range(n))),tuple((len(rings)-1)*n+i for i in range(n))])
    data=bpy.data.meshes.new(name); data.from_pydata(verts,[],faces); data.update()
    o=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(o); finish(o,name,g,m)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
    mod=o.modifiers.new('Tailored surface','SUBSURF'); mod.levels=2; bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(); bpy.ops.object.mode_set(mode='OBJECT')
    return o

# Tailored shirt silhouette with overlapping soft folds, collar, seams and buttons.
g=group('TailoredTorso')
loft('Fitted shirt',g,fabric,[(-.10,.177,.123),(-.07,.182,.13),(.04,.20,.14),(.18,.226,.139),(.27,.24,.117),(.31,.18,.09),(.34,.083,.071)])
loft('Trouser hips',g,denim,[(-.27,.167,.115),(-.23,.187,.133),(-.11,.181,.13),(-.08,.17,.12)])
for side in [-1,1]:
    c=cube('Collar',g,fabric,(side*.067,.325,-.074),(.105,.045,.115),.012); c.rotation_euler[1]=side*.32
    cube('Pocket',g,fabric,(side*.115,.18,-.126),(.09,.10,.023),.01)
    for i in range(5):
        e=ell('Cloth fold',g,fabric,(side*.15,-.02+i*.048,-.104),(.065,.008,.025)); e.rotation_euler[1]=side*.22
for i in range(5): ell('Button',g,alloy,(0,-.045+i*.069,-.144),(.006,.006,.004))
g=group('CanvasThigh'); loft('Thigh',g,denim,[(.025,.094,.095),(-.04,.094,.098),(-.16,.085,.091),(-.29,.073,.08),(-.39,.072,.077),(-.405,.072,.077)])
for i in range(4): ell('Knee crease',g,denim,(0,-.33+i*.015,-.062),(.075,.007,.02))
g=group('CanvasShin'); loft('Calf',g,denim,[(.022,.073,.078),(.005,.073,.078),(-.06,.078,.082),(-.14,.072,.086),(-.26,.058,.066),(-.38,.055,.061)])
# Complete rolling wheel on the local X axle. Original game steering pivots remain functional.
g=group('TouringWheel')
bpy.ops.mesh.primitive_torus_add(major_radius=.325,minor_radius=.105,major_segments=64,minor_segments=16,rotation=(0,math.pi/2,0)); finish(bpy.context.object,'Rounded tire carcass',g,rubber)
for i in range(56):
    a=i*math.tau/56
    for side in [-1,1]:
        o=cube('Tread block',g,rubber,(side*.052,math.sin(a)*.427,math.cos(a)*.427),(.075,.025,.052),.005); o.rotation_euler[0]=a; o.rotation_euler[2]=side*.22
for side in [-1,1]:
    bpy.ops.mesh.primitive_torus_add(major_radius=.247,minor_radius=.014,major_segments=48,minor_segments=8,location=(side*.095,0,0),rotation=(0,math.pi/2,0)); finish(bpy.context.object,'Rim lip',g,alloy)
    for i in range(10):
        a=i*math.tau/10
        o=cube('Forged spoke',g,alloy,(side*.095,math.sin(a)*.14,math.cos(a)*.14),(.025,.032,.235),.008); o.rotation_euler[0]=a
    ell('Hub',g,alloy,(side*.10,0,0),(.025,.055,.055))
# Individually shaped rocks, with vertex color mineral variation exported to glTF.
for index in range(3):
    g=group('CoastalRock'+str(index))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3,radius=1)
    o=bpy.context.object
    for v in o.data.vertices:
        v.co *= random.uniform(.88,1.12); v.co.z=max(-.24,v.co.z*.65)
    o.location.z=.25
    finish(o,'Granite',g,rockmat)
    attr=o.data.color_attributes.new(name='Minerals',type='FLOAT_COLOR',domain='POINT')
    for c in attr.data:
        n=random.uniform(.65,1); c.color=(n,n*.97,n*.87,1)
g=group('CoastalShrub')
for i in range(36):
    a=random.random()*math.tau; r=random.random()*.7; y=random.random()*.65+.12
    o=ell('Leaf cluster',g,leaf,(math.cos(a)*r,y,math.sin(a)*r),(.16,.055,.075)); o.rotation_euler=(random.random(),random.random(),a)
# A proportioned head assembled as one exportable facial mesh, with separate eye surfaces.
skin=mat('Warm skin',(.50,.285,.18),.61)
hair=mat('Dark brown hair',(.035,.022,.016),.86)
lips=mat('Natural lip tone',(.32,.13,.095),.68)
eye=mat('Eye whites',(.66,.64,.57),.2)
iris=mat('Brown iris',(.07,.038,.017),.24)
pupil=mat('Pupil',(.006,.005,.004),.13)
g=group('TailoredUpperArm'); loft('Sleeve',g,fabric,[(.045,.087,.089),(-.015,.091,.094),(-.09,.083,.085),(-.155,.073,.075)])
loft('Upper arm',g,skin,[(-.14,.057,.059),(-.20,.056,.058),(-.285,.048,.05)])
g=group('NaturalForearm'); loft('Forearm',g,skin,[(.012,.05,.052),(-.065,.054,.055),(-.14,.046,.049),(-.26,.035,.038)])
g=group('SculptedHead')
ell('Cranium',g,skin,(0,.018,.014),(.122,.157,.111))
ell('Jaw',g,skin,(0,-.072,-.024),(.089,.078,.09))
ell('Chin',g,skin,(0,-.119,-.068),(.052,.033,.045))
ell('Nose bridge',g,skin,(0,-.004,-.096),(.019,.055,.032))
ell('Nose tip',g,skin,(0,-.034,-.127),(.024,.018,.023))
for side in [-1,1]:
    ell('Cheekbone',g,skin,(side*.067,-.029,-.07),(.052,.045,.045))
    ell('Nose wing',g,skin,(side*.021,-.044,-.112),(.014,.012,.016))
    ell('Nostril',g,lips,(side*.013,-.05,-.125),(.006,.004,.005))
    ell('Ear',g,skin,(side*.12,-.014,.005),(.022,.044,.022))
    ell('Ear concha',g,lips,(side*.135,-.014,-.007),(.008,.025,.01))
    ell('Eye socket',g,skin,(side*.046,.028,-.077),(.036,.024,.035))
    ell('Eye',g,eye,(side*.046,.026,-.103),(.023,.010,.012))
    ell('Iris',g,iris,(side*.046,.026,-.114),(.009,.009,.003))
    ell('Pupil',g,pupil,(side*.046,.026,-.117),(.004,.005,.002))
    ell('Upper eyelid',g,skin,(side*.046,.036,-.108),(.026,.005,.008))
    ell('Lower eyelid',g,skin,(side*.046,.016,-.107),(.025,.004,.007))
    ell('Eyebrow',g,hair,(side*.046,.054,-.099),(.029,.004,.007))
ell('Upper lip',g,lips,(0,-.079,-.107),(.032,.005,.009))
ell('Lower lip',g,lips,(0,-.089,-.106),(.028,.006,.008))
ell('Hair cap',g,hair,(0,.115,.026),(.121,.07,.107))
ell('Back hair',g,hair,(0,.025,.102),(.11,.12,.047))
for i in range(32):
    x=-.105+i*.0067
    ell('Combed strand',g,hair,(x,.153-abs(x)*.18,.006),(.004,.019,.076))
# Weld the facial volumes into a continuous surface instead of visible primitive joints.
face_parts=[o for o in g.children if o.type == 'MESH' and o.data.materials[0] == skin]
bpy.ops.object.select_all(action='DESELECT')
for o in face_parts: o.select_set(True)
bpy.context.view_layer.objects.active=face_parts[0]; bpy.ops.object.join()
face=bpy.context.object; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
mod=face.modifiers.new('Sculpted facial surface','REMESH'); mod.mode='VOXEL'; mod.voxel_size=.0035
bpy.ops.object.modifier_apply(modifier=mod.name)
mod=face.modifiers.new('Skin smoothing','SMOOTH'); mod.factor=.7; mod.iterations=5
bpy.ops.object.modifier_apply(modifier=mod.name)
for polygon in face.data.polygons: polygon.use_smooth=True
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(); bpy.ops.object.mode_set(mode='OBJECT')
# Baked skin pigment and fine pores survive glTF export.
image=bpy.data.images.new('Skin pores',width=256,height=256); pixels=[]
for i in range(256*256):
    n=.93+random.random()*.12
    pixels.extend([.50*n,.285*n,.18*n,1])
image.pixels=pixels; image.pack()
node=skin.node_tree.nodes.new('ShaderNodeTexImage'); node.image=image
skin.node_tree.links.new(node.outputs['Color'],skin.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
# Broad folded palm leaflets, with solid silhouettes and enough separation to read at distance.
g=group('PalmFrond'); verts=[]; faces=[]
for i in range(18):
    t=(i+1)/20; y=math.sin(t*math.pi)*1.05-t*t*1.6; z=-t*6
    reach=math.sin(t*math.pi)*1.1+.1
    for side in [-1,1]:
        base=len(verts)
        for v in [(0,y,z+.08),(side*reach*.55,y+.06,z-.08),(side*reach,y-.25,z-.5),(side*reach*.5,y-.06,z-.32)]: verts.append(pos(v))
        faces.extend([(base,base+1,base+2),(base,base+2,base+3)])
mesh=bpy.data.meshes.new('Feathered palm'); mesh.from_pydata(verts,[],faces); mesh.update()
o=bpy.data.objects.new('Palm blade',mesh); bpy.context.collection.objects.link(o); finish(o,'Palm blade',g,leaf)
# Louvered shutters and deep sills for guesthouse facades.
wood=mat('Weathered teak',(.20,.115,.059),.84)
g=group('WindowShutters')
for side in [-1,1]:
    cube('Frame',g,wood,(side*1.13,0,0),(.42,1.8,.09),.014)
    for i in range(14):
        o=cube('Louver',g,wood,(side*1.13,-.78+i*.12,-.055),(.36,.08,.045),.008); o.rotation_euler[0]=.25
cube('Stone sill',g,rockmat,(0,-.96,0),(2.85,.12,.33),.018)

# Six original detailed weapon props. Dimensions match the game's muzzle anchors.
gunmetal=mat('Anodized gunmetal',(.07,.082,.09),.36,.72)
polymer=mat('Matte grip polymer',(.035,.043,.041),.83)
steel=mat('Machined steel',(.23,.26,.27),.3,.85)
def tube(name,g,m,p,r,length):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=r,depth=length,location=pos(p),rotation=(math.pi/2,0,0))
    return finish(bpy.context.object,name,g,m)
for slot,length in enumerate([.16,.4,.34,.23,.6,.24]):
    g=group('DetailedWeapon'+str(slot))
    long=slot in [1,2,3,4]
    cube('Receiver',g,gunmetal,(0,.07,-.095),(.076,.087,.27 if long else .21),.009)
    grip=cube('Grip',g,polymer,(0,-.025,.006),(.058,.15,.076),.012); grip.rotation_euler[0]=-.16
    for i in range(7): cube('Grip stippling',g,gunmetal,(0,-.075+i*.014,.046),(.052,.005,.005),.001)
    tube('Barrel',g,steel,(0,.078,-.22-length/2),.017 if slot != 2 else .025,length)
    tube('Muzzle recess',g,polymer,(0,.078,-.224-length),.012 if slot != 2 else .021,.008)
    cube('Rear sight',g,steel,(0,.126,-.008),(.052,.022,.025),.004)
    cube('Front sight',g,steel,(0,.111,-.21-length),(.015,.029,.018),.002)
    bpy.ops.mesh.primitive_torus_add(major_radius=.034,minor_radius=.005,major_segments=20,minor_segments=6,location=pos((0,-.025,-.084)),rotation=(0,math.pi/2,0)); finish(bpy.context.object,'Trigger guard',g,gunmetal)
    cube('Trigger',g,steel,(0,-.014,-.079),(.009,.03,.01),.003)
    cube('Ejection port',g,polymer,(.04,.084,-.082),(.004,.031,.065),.002)
    cube('Bolt',g,steel,(.044,.085,-.065),(.009,.013,.03),.002)
    if long:
        cube('Stock',g,polymer,(0,.05,.165),(.067,.112,.22 if slot != 3 else .14),.013)
        cube('Butt pad',g,polymer,(0,.046,.281 if slot != 3 else .24),(.08,.137,.02),.008)
        cube('Handguard',g,wood if slot == 2 else polymer,(0,.075,-.29),(.08,.085,.18),.012)
        for i in range(9):
            cube('Vent',g,gunmetal,(.043,.085,-.215-i*.018),(.008,.032,.008),.002)
            cube('Rail tooth',g,steel,(0,.122,-.20-i*.018),(.063,.008,.007),.001)
        if slot != 2:
            magazine=cube('Magazine',g,polymer,(0,-.065,-.115),(.053,.19,.078),.009); magazine.rotation_euler[0]=-.14
            for i in range(3): cube('Magazine groove',g,steel,(.029,-.065,-.14+i*.018),(.003,.13,.004),.001)
        else: tube('Magazine tube',g,gunmetal,(0,.035,-.36),.018,.31)
    else:
        for i in range(7): cube('Slide serration',g,steel,(.04,.083,-.022-i*.009),(.004,.05,.003),.001)
    if slot == 4:
        cube('Scope mount',g,steel,(0,.137,-.095),(.048,.035,.13),.003)
        tube('Optic',g,polymer,(0,.19,-.12),.035,.26)
        tube('Objective glass',g,iris,(0,.19,-.254),.03,.004)
        tube('Turret',g,steel,(.035,.19,-.1),.015,.027)
    if slot == 5:
        tube('Cylinder',g,steel,(0,.067,-.051),.053,.087)
        for i in range(6):
            a=i*math.tau/6
            tube('Chamber detail',g,polymer,(math.cos(a)*.035,.067+math.sin(a)*.035,-.098),.01,.006)

# Merge static pieces per asset; retain material slots without hundreds of draw calls.
for root in [o for o in bpy.context.scene.objects if o.type == 'EMPTY']:
    children=[o for o in root.children if o.type == 'MESH']
    if not children: continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in children: o.select_set(True)
    bpy.context.view_layer.objects.active=children[0]
    bpy.ops.object.join()
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'coastal-assets.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'coastal-assets.glb'),export_format='GLB',export_yup=True)
print('ASSETS_EXPORTED')
