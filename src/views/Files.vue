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

<!-- src/views/Files.vue -->
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
  PutObjectCommand, // <-- 导入用于单文件上传的命令
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
    await fetchFiles(); // Refresh list
  } catch (e) {
    alert(`Failed to delete file: ${e.message}`);
    console.error(e);
  } finally {
    loading.delete = null;
  }
}

const formatBytes = (bytes, decimals = 2) => {
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};


onMounted(() => {
  fetchFiles();

  uppy.value = new Uppy({
    autoProceed: true,
    debug: true,
    // 可选：设置分片大小，让测试更容易触发分片逻辑
    // chunkSize: 5 * 1024 * 1024, // 5MB
  }).use(AwsS3Multipart, {
    // 1. 创建分片上传事务 (只对大文件调用)
    createMultipartUpload: async (file) => {
      console.log('Creating multipart upload for:', file.name);
      const command = new CreateMultipartUploadCommand({
        Bucket: props.bucketName,
        Key: file.name,
        ContentType: file.type,
      });
      const data = await s3Client.send(command);
      return { uploadId: data.UploadId, key: data.Key };
    },

    // 2. 为上传获取参数 (对小文件和每个分片都会调用)
    getUploadParameters: async (file, partData) => {
      // 核心修正：判断是分片上传还是单文件上传
      if (partData.uploadId) {
        // --- 这是分片上传 ---
        const { number, uploadId } = partData;
        console.log(`Getting presigned URL for PART: ${number} of ${file.name}`);
        const command = new UploadPartCommand({
          Bucket: props.bucketName,
          Key: file.name,
          PartNumber: number,
          UploadId: uploadId,
        });
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15分钟
        return { method: 'PUT', url: presignedUrl, fields: {}, headers: {} };

      } else {
        // --- 这是单文件上传 ---
        console.log(`Getting presigned URL for SINGLE FILE: ${file.name}`);
        const command = new PutObjectCommand({
          Bucket: props.bucketName,
          Key: file.name,
          ContentType: file.type,
        });
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15分钟
        return { method: 'PUT', url: presignedUrl, fields: {}, headers: {} };
      }
    },

    // 3. 完成上传 (只对大文件调用)
    completeMultipartUpload: async (file, { uploadId, key, parts }) => {
      console.log('Completing multipart upload for:', file.name);
      const command = new CompleteMultipartUploadCommand({
        Bucket: props.bucketName,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      });
      const data = await s3Client.send(command);
      return { location: data.Location };
    },

    // 4. 中止上传 (只对大文件调用)
    abortMultipartUpload: async (file, { uploadId, key }) => {
      console.log('Aborting multipart upload for:', file.name);
      const command = new AbortMultipartUploadCommand({
        Bucket: props.bucketName,
        Key: key,
        UploadId: uploadId,
      });
      await s3Client.send(command);
    },
  });

  // 监听单个文件上传成功事件
  uppy.value.on('upload-success', (file, response) => {
    console.log(`${file.name} uploaded successfully!`);

    // 乐观更新UI：立即将新文件添加到列表顶部，提供即时反馈
    // 注意：这里的 size 和 lastModified 是估算的，会被后续的 fetchFiles 更新
    const newFile = {
      Key: file.name,
      Size: file.size,
      LastModified: new Date().toISOString(), // 使用当前时间
    };
    files.value.unshift(newFile); // 添加到数组开头

    // 可以在稍后调用 fetchFiles 来确保数据完全同步
    // 但为了更好的用户体验，可以等待 complete 事件或只依赖乐观更新
  });

  // 监听所有文件处理完成的事件
  uppy.value.on('complete', (result) => {
    console.log('All uploads complete, refreshing list from server.');
    if (result.successful.length > 0) {
      // 延迟一段时间以确保后端数据一致性
      setTimeout(() => {
        fetchFiles();
      }, 1500); // 这里的延迟现在是作为最终同步，可以适当调整
    }
    if (result.failed.length > 0) {
      console.error('Some uploads failed:', result.failed);
      // 如果有失败，也最好刷新一下列表，以防有部分成功的文件
      fetchFiles();
    }
  });
});

onUnmounted(() => {
  if (uppy.value) {
    uppy.value.close();
  }
});
</script>
