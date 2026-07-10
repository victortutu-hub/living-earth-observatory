export const PLATFORM_TAXONOMY = Object.freeze({
      families: Object.freeze([
        {id:'planetary',label:'Planetary Systems',short:'Planetary',description:'Planets, atmosphere, oceans, climate and geophysical signals.',accent:'34,211,238'},
        {id:'life',label:'Life Systems',short:'Life',description:'Molecular, cellular, organismal and ecological structure.',accent:'139,92,246'},
        {id:'cosmic',label:'Cosmic Systems',short:'Cosmic',description:'Solar, stellar, galactic and cosmological phenomena.',accent:'99,102,241'},
        {id:'matter-fields',label:'Matter & Fields',short:'Matter',description:'Plasma, quantum fields, crystals, fluids and electromagnetic systems.',accent:'251,191,36'},
        {id:'mathematical',label:'Mathematical Reality',short:'Mathematical',description:'Topology, geometry, dynamical systems, chaos and information.',accent:'232,121,249'},
        {id:'computational',label:'Computational Systems',short:'Computational',description:'Networks, algorithms, emergence and synthetic cognition.',accent:'103,232,249'}
      ]),
      scales: Object.freeze([
        {id:'quantum',label:'Quantum',order:0},
        {id:'atomic',label:'Atomic',order:1},
        {id:'molecular',label:'Molecular',order:2},
        {id:'cellular',label:'Cellular',order:3},
        {id:'organism',label:'Organism',order:4},
        {id:'ecological',label:'Ecological',order:5},
        {id:'planetary',label:'Planetary',order:6},
        {id:'stellar',label:'Stellar',order:7},
        {id:'galactic',label:'Galactic',order:8},
        {id:'cosmological',label:'Cosmological',order:9}
      ]),
      statuses: Object.freeze([
        {id:'live',label:'Live'},
        {id:'development',label:'In development'},
        {id:'research',label:'Research'},
        {id:'planned',label:'Planned'},
        {id:'archived',label:'Archived'}
      ]),
      representations: Object.freeze([
        {id:'observed',label:'Observed'},
        {id:'reconstructed',label:'Reconstructed'},
        {id:'physical-model',label:'Physical model'},
        {id:'prediction',label:'Prediction'},
        {id:'simulation',label:'Simulation'},
        {id:'interpretive',label:'Interpretive'},
        {id:'fallback',label:'Fallback'}
      ])
    });
