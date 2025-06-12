<!-- src/views/Files.vue -->
<template>
  <div class="space-y-6">
    <h1 class="text-3xl font-bold text-gray-800">
      Bucket: <span class="text-indigo-600">{{ bucketName }}</span>
    </h1>

    <!-- Upload Section -->
    <div class="bg-white p-6 rounded-lg shadow-lg">
      <h2 class="text-xl font-bold mb-4">Upload Files to this Bucket</h2>
      <Dashboard v-if="uppy" :uppy="uppy" :props="{ theme: 'light', proudllyDisplayPoweredByUppy: false }" />
    </div>

    <!-- File List Section -->
    <div class="bg-white p-6 rounded-lg shadow-lg">
      <h2 class="text-xl font-bold mb-4">Files in Bucket</h2>
      <div v-if="loading.list" class="text-center">Loading files...</div>
      <div v-else-if="error.list" class="text-red-500">{{ error.list }}</div>
      <table v-else-if="files.length" class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
        <tr>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Modified</th>
          <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
        </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
        <tr v-for="file in files" :key="file.Key">
          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{{ file.Key }}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ formatBytes(file.Size) }}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ new Date(file.LastModified).toLocaleString() }}</td>
          <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
            <button @click="deleteFile(file.Key)" class="text-red-600 hover:text-red-800 disabled:text-gray-400" :disabled="loading.delete === file.Key">
              <span v-if="loading.delete === file.Key">Deleting...</span>
              <span v-else>Delete</span>
            </button>
          </td>
        </tr>
        </tbody>
      </table>
      <p v-else class="text-gray-500">No files found in this bucket.</p>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, defineProps } from 'vue';
import { s3Client } from '../s3Client';
import {
  ListObjectsV2Command,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { Dashboard } from '@uppy/vue';
import Uppy from '@uppy/core';
import AwsS3Multipart from '@uppy/aws-s3-multipart';

const props = defineProps({
  bucketName: {
    type: String,
    required: true,
  },
});

const files = ref([]);
const loading = reactive({ list: false, delete: null });
const error = reactive({ list: null });
const uppy = ref(null);

async function fetchFiles() {
  loading.list = true;
  error.list = null;
  try {
    const { Contents } = await s3Client.send(new ListObjectsV2Command({ Bucket: props.bucketName }));
    files.value = (Contents || []).sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
  } catch (e) {
    error.list = `Failed to fetch files: ${e.message}`;
    console.error(e);
  } finally {
    loading.list = false;
  }
}

async function deleteFile(key) {
  if (!confirm(`Are you sure you want to delete the file "${key}"?`)) {
    return;
  }
  loading.delete = key;
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: props.bucketName, Key: key }));
    await fetchFiles();
  } catch (e) {
    alert(`Failed to delete file: ${e.message}`);
    console.error(e);
  } finally {
    loading.delete = null;
  }
}

const formatBytes = (bytes, decimals = 2) => {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

onMounted(() => {
  // 核心修正 1：先同步创建 Uppy 实例，再执行异步操作
  try {
    uppy.value = new Uppy({
      autoProceed: true,
      debug: true,
      restrictions: {
        minPartSize: 10 * 1024 * 1024,
      }
    }).use(AwsS3Multipart, {
      limit: 5,
      getUploadParameters: async (file) => {
        console.log(`[Non-Multipart] Getting presigned URL for SINGLE FILE: ${file.name}`);
        const command = new PutObjectCommand({
          Bucket: props.bucketName,
          Key: file.name,
          ContentType: file.type,
        });
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
        return { method: 'PUT', url: presignedUrl, fields: {}, headers: {} };
      },
      createMultipartUpload: async (file) => {
        console.log('[Multipart] Creating for:', file.name);
        const command = new CreateMultipartUploadCommand({
          Bucket: props.bucketName,
          Key: file.name,
          ContentType: file.type,
        });
        const data = await s3Client.send(command);
        return { uploadId: data.UploadId, key: data.Key };
      },
      signPart: async (file, { uploadId, partNumber, key }) => {
        console.log(`[Multipart] Signing PART: ${partNumber} for ${file.name}`);
        const command = new UploadPartCommand({
          Bucket: props.bucketName,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        });
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
        return { url: presignedUrl };
      },
      completeMultipartUpload: async (file, { uploadId, key, parts }) => {
        console.log('[Multipart] Completing for:', file.name, 'Parts:', parts.length);
        const sortedParts = parts.sort((a, b) => a.PartNumber - b.PartNumber);
        const command = new CompleteMultipartUploadCommand({
          Bucket: props.bucketName,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: sortedParts },
        });
        const data = await s3Client.send(command);
        return { location: data.Location };
      },
      abortMultipartUpload: async (file, { uploadId, key }) => {
        console.log('[Multipart] Aborting for:', file.name);
        const command = new AbortMultipartUploadCommand({
          Bucket: props.bucketName,
          Key: key,
          UploadId: uploadId,
        });
        await s3Client.send(command);
      },
    });

    // 绑定事件监听器
    uppy.value.on('upload-success', (file, response) => {
      console.log(`${file.name} uploaded successfully!`);
      const newFile = {
        Key: file.name,
        Size: file.size,
        LastModified: new Date().toISOString(),
      };
      if (!files.value.some(f => f.Key === newFile.Key)) {
        files.value.unshift(newFile);
        files.value.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
      }
    });

    uppy.value.on('complete', (result) => {
      console.log('All uploads complete, queueing refresh...');
      if (result.successful.length > 0 || result.failed.length > 0) {
        setTimeout(() => {
          console.log('Refreshing list from server now.');
          fetchFiles();
        }, 2000);
      }
      if (result.failed.length > 0) {
        console.error('Some uploads failed:', result.failed);
      }
    });

  } catch (e) {
    console.error("Failed to initialize Uppy:", e);
    error.list = "Uppy uploader failed to initialize.";
  }

  // 最后再执行异步的数据获取
  fetchFiles();
});

onUnmounted(() => {
  console.log('Files.vue is being unmounted. Attempting to close Uppy.');
  // 核心修正 2：增加更健壮的检查
  if (uppy.value && typeof uppy.value.close === 'function') {
    try {
      uppy.value.close();
      console.log('Uppy instance closed successfully.');
      uppy.value = null; // 手动置空，帮助垃圾回收
    } catch (e) {
      console.error('An error occurred while closing Uppy:', e);
    }
  } else {
    console.warn('Uppy instance was not available or invalid on unmount.');
  }
});
</script>
