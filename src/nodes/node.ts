import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import { delay } from "../utils";

type NodeState={
  killed:boolean;
  x:0|1|"?"|null;
  decided:boolean|null;
  k:number|null;
};

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());
  let proposals:Map<number,Value[]>=new Map();
  let votes:Map<number,Value[]>=new Map();
  node.get("/status",(req,res)=>{
    if(isFaulty){
      res.status(500).send("faulty");
    }
    else{
      res.status(200).send("live");
    }
  });

  node.post("/message",async(req,res)=>{
    let {k,x,messageType}=req.body;
    if (!isFaulty && !NodeState.killed){
      if (messageType==="propose"){
        if (!proposals.has(k)){
          proposals.set(k,[]);
        }
        proposals.get(k)!.push(x);
        let proposal=proposals.get(k)!;
        if (proposal.length>=(N-F)){
          let count0=proposal.filter((el)=>el===0).length;
          let count1=proposal.filter((el)=>el===1).length;
          if (count0>N/2){
            x=0;
          }
          else if (count1>N/2){
            x=1;
          }
          else{
            x="?";
          }
          const sendMessage=(port:number,data:{k:string,x:string,messageType:string})=>{
            fetch('http://localhost:'+String(port)+'/message',{
              method:"POST",
              headers:{
                "Content-Type":"application/json",
              },
              body:JSON.stringify(data),
            });
          };
          for (let i=0;i<N;i++){
            sendMessage(BASE_NODE_PORT+i,{k:k,x:x,messageType:"vote"});
          }
        }
      }
      else if (messageType==="vote"){
        if (!votes.has(k)){
          votes.set(k,[]);
        }
        votes.get(k)!.push(x);
        let vote=votes.get(k)!;
        if (vote.length>=(N-F)){
          let count0=vote.filter((el)=>el===0).length;
          let count1=vote.filter((el)=>el===1).length;
          if (count0>=F+1){
            NodeState.x=0;
            NodeState.decided=true;
          }
          else if (count1>=F+1){
            NodeState.x=1;
            NodeState.decided=true;
          }
          else{
            if (count0+count1==0){
              NodeState.x=Math.random()>0.5?0:1;
            }
            else{
              if (count0>count1){
                NodeState.x=0;
              }
              else{
                NodeState.x=1;
              }
            }
            NodeState.k=k+1;
            const sendMessage=async(port:number,data:any)=>{
              await fetch('http://localhost:'+String(BASE_NODE_PORT+port)+'/message',{
                method:"POST",
                headers:{
                  "Content-Type":"application/json",
                },
                body:JSON.stringify(data)
              });
            };
            for (let i=0;i<N;i++){
              sendMessage(i,{
                k:NodeState.k,
                x:NodeState.x,
                messageType:"propose",
              });
            }
          }
        }
      }
    }
    res.status(200).send("Message received and processed.");
  });

  node.get("/start",async(req,res)=>{
    while (!nodesAreReady()){
      await delay(100);
    }
    if(!isFaulty){
      NodeState.k=1;
      NodeState.x=Math.random()<0.5?0:1;
      NodeState.decided=false;
      for (let i=0;i<N;i++){
        fetch('http://localhost:'+String(BASE_NODE_PORT+i)+'/message',{
          method:"POST",
          headers:{
            "Content-Type":"application/json",
          },
          body:JSON.stringify({k:NodeState.k, x:NodeState.x,messageType:"propose"}),
        });
      }
    }
    else{
      NodeState.decided=null;
      NodeState.x=null;
      NodeState.k=null;
    }
    res.status(200).send("Consensus algorithm started.");
  });

  node.get("/stop",(req,res)=>{
    NodeState.killed=true;
    res.status(200).send("killed")
  })

  node.get("/getState",async(req,res)=>{
    res.json(NodeState);
  });

  let NodeState:NodeState={
    killed:false,
    x:null,
    decided:null,
    k:null
  };
  if(!isFaulty){
    NodeState={
      killed:false,
      x:initialValue,
      decided:null,
      k:0
    };
  }

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
