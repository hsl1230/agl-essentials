const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

// Create 128x128 canvas
const canvas = createCanvas(128, 128);
const ctx = canvas.getContext('2d');

// Transparent background - no fill needed

// Node gradient (blue)
const nodeGrad = ctx.createLinearGradient(0, 0, 128, 128);
nodeGrad.addColorStop(0, '#4FC3F7');
nodeGrad.addColorStop(1, '#2196F3');

// Top node (AGL) - Wider box for larger text
ctx.beginPath();
ctx.roundRect(12, 2, 104, 44, 6);
ctx.fillStyle = nodeGrad;
ctx.shadowColor = 'rgba(0,0,0,0.3)';
ctx.shadowBlur = 4;
ctx.shadowOffsetY = 2;
ctx.fill();
ctx.shadowBlur = 0;

// AGL text with glow effect - even larger, yellow color for visibility
ctx.fillStyle = '#FFEB3B';
ctx.font = 'bold 44px Arial';
ctx.textAlign = 'center';
ctx.shadowColor = 'rgba(255, 235, 59, 0.8)';
ctx.shadowBlur = 6;
// Draw letters separately for better spacing - G centered at 64
ctx.fillText('A', 32, 38);
ctx.fillText('G', 64, 38);
ctx.fillText('L', 96, 38);
ctx.shadowBlur = 0;

// Single line from AGL down to split point
ctx.strokeStyle = '#64B5F6';
ctx.lineWidth = 3;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

ctx.beginPath();
ctx.moveTo(64, 46);
ctx.lineTo(64, 62);
ctx.stroke();

// Three branches with arrows pointing to circles
// Left branch: horizontal left, then very short down to A circle
ctx.beginPath();
ctx.moveTo(64, 62);
ctx.lineTo(26, 62);
ctx.quadraticCurveTo(20, 62, 20, 68);
ctx.lineTo(20, 78);
ctx.stroke();

// Left arrow pointing to A circle - connects at y=78
ctx.fillStyle = '#64B5F6';
ctx.beginPath();
ctx.moveTo(20, 85);
ctx.lineTo(15, 78);
ctx.lineTo(25, 78);
ctx.closePath();
ctx.fill();

// Center branch: very short down to V circle
ctx.beginPath();
ctx.moveTo(64, 62);
ctx.lineTo(64, 78);
ctx.stroke();

// Center arrow pointing to V circle - connects at y=78
ctx.beginPath();
ctx.moveTo(64, 85);
ctx.lineTo(59, 78);
ctx.lineTo(69, 78);
ctx.closePath();
ctx.fill();

// Right branch: horizontal right, then very short down to S circle (mirror of left)
ctx.beginPath();
ctx.moveTo(64, 62);
ctx.lineTo(102, 62);
ctx.quadraticCurveTo(108, 62, 108, 68);
ctx.lineTo(108, 78);
ctx.stroke();

// Right arrow pointing to S circle - connects at y=78
ctx.beginPath();
ctx.moveTo(108, 85);
ctx.lineTo(103, 78);
ctx.lineTo(113, 78);
ctx.closePath();
ctx.fill();

// Bottom nodes - Larger circles (r=20) with bigger text
// Green node (A) - positioned at x=20
const greenGrad = ctx.createRadialGradient(20, 105, 0, 20, 105, 20);
greenGrad.addColorStop(0, '#81C784');
greenGrad.addColorStop(1, '#4CAF50');

ctx.beginPath();
ctx.arc(20, 105, 20, 0, Math.PI * 2);
ctx.fillStyle = greenGrad;
ctx.shadowColor = 'rgba(0,0,0,0.3)';
ctx.shadowBlur = 4;
ctx.shadowOffsetY = 2;
ctx.fill();
ctx.shadowBlur = 0;

ctx.fillStyle = '#fff';
ctx.font = 'bold 30px Arial';
ctx.fillText('A', 20, 116);

// Orange node (V) - centered at x=64
const orangeGrad = ctx.createRadialGradient(64, 105, 0, 64, 105, 20);
orangeGrad.addColorStop(0, '#FFB74D');
orangeGrad.addColorStop(1, '#FF9800');

ctx.beginPath();
ctx.arc(64, 105, 20, 0, Math.PI * 2);
ctx.fillStyle = orangeGrad;
ctx.shadowColor = 'rgba(0,0,0,0.3)';
ctx.shadowBlur = 4;
ctx.shadowOffsetY = 2;
ctx.fill();
ctx.shadowBlur = 0;

ctx.fillStyle = '#fff';
ctx.font = 'bold 30px Arial';
ctx.fillText('V', 64, 116);

// Purple node (S) - positioned at x=108
const purpleGrad = ctx.createRadialGradient(108, 105, 0, 108, 105, 20);
purpleGrad.addColorStop(0, '#BA68C8');
purpleGrad.addColorStop(1, '#9C27B0');

ctx.beginPath();
ctx.arc(108, 105, 20, 0, Math.PI * 2);
ctx.fillStyle = purpleGrad;
ctx.shadowColor = 'rgba(0,0,0,0.3)';
ctx.shadowBlur = 4;
ctx.shadowOffsetY = 2;
ctx.fill();
ctx.shadowBlur = 0;

ctx.fillStyle = '#fff';
ctx.font = 'bold 30px Arial';
ctx.fillText('S', 108, 116);

// Save to PNG
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(path.join(__dirname, 'resources', 'icon.png'), buffer);
console.log('Icon generated: resources/icon.png');