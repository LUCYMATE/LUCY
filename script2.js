import fs from 'fs'; const doc = JSON.parse(fs.readFileSync('public/myra.gltf')); const names = doc.nodes.map(n => n.name).filter(n => n); console.log(JSON.stringify(names));
